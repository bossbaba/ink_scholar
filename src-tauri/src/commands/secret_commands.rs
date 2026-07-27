//! API Key 加密存储：把 AI provider 的密钥用 AES-256-GCM 加密后存入本地 SQLite
//! 数据库（`provider_secrets` 表），读取时解密使用。
//!
//! **设计约束（用户明确要求）**：
//! - **不**使用操作系统钥匙串（macOS Keychain / Windows Credential Manager / 任何
//!   「其他软件」），密钥只落在应用自有的本地数据库文件 `~/Documents/InkScholar/ink_scholar.db`。
//! - 明文 key 永不落盘；落盘的是 `AES-256-GCM(ciphertext, nonce, tag)` 的 base64 形式。
//!
//! **密钥派生策略（本地数据库加密，满足「异机不可解」）**：
//! - 应用内置一个固定的密钥材料常量 `APP_PEPPER`（编译期常量，作为 HKDF 的 IKM）；
//! - 用 HKDF-SHA256 以「设备标识(hostname)」作为 info 派生出 32 字节 AES 密钥；
//! - 效果：数据库文件被拷贝到其它设备时，因 hostname 不同无法派生出相同密钥，无法解密；
//!   同机进程可解密（安全模型为「本机专用」，与本地优先的桌面写作工具定位一致）。
//! - 边界：若用户重命名主机或修改 hostname，已存的 key 将无法解密，需重新填写
//!   （前端 `secure_get_api_key` 返回错误时由 `loadProviders` 容忍并提示）。

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use hkdf::Hkdf;
use rusqlite::params;
use sha2::Sha256;
use tauri::{command, State};

use crate::db::DbConnection;

/// 应用内置密钥材料（编译期常量）。作为 HKDF 的 IKM，长度不限。
/// 它不提供「防止本机逆向」的能力（任何能读到二进制的人都能拿到），
/// 这里的作用是结合设备标识后，使数据库文件离开本机即无法解密。
const APP_PEPPER: &[u8] = b"InkScholar::local::aes256::pepper::v1::000000000000";

/// HKDF salt，固定常量。
const KDF_SALT: &[u8] = b"ink_scholar::secret::kdf::salt::v1";

/// 由设备标识派生 32 字节 AES-256 密钥。
fn derive_aes_key(device_id: &str) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(KDF_SALT), APP_PEPPER);
    let mut okm = [0u8; 32];
    hk.expand(device_id.as_bytes(), &mut okm)
        .expect("HKDF expand 失败（info 长度合法，不应发生）");
    okm
}

/// 获取设备标识：优先使用主机名，失败回退固定字符串。
fn device_id() -> String {
    gethostname::gethostname()
        .into_string()
        .unwrap_or_else(|_| "ink-scholar-device".to_string())
}

/// AES-256-GCM 加密，返回 (ciphertext_b64, nonce_b64)。
fn encrypt_key(device_id: &str, plaintext: &str) -> Result<(String, String), String> {
    let key = derive_aes_key(device_id);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("加密 API Key 失败: {}", e))?;
    Ok((B64.encode(&ciphertext), B64.encode(&nonce_bytes)))
}

/// AES-256-GCM 解密，输入 (ciphertext_b64, nonce_b64)。
fn decrypt_key(device_id: &str, ciphertext_b64: &str, nonce_b64: &str) -> Result<String, String> {
    let key = derive_aes_key(device_id);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ciphertext = B64
        .decode(ciphertext_b64)
        .map_err(|_| "密文 base64 解码失败（数据库可能损坏）".to_string())?;
    let nonce_bytes = B64
        .decode(nonce_b64)
        .map_err(|_| "nonce base64 解码失败（数据库可能损坏）".to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
        "解密失败：密钥不匹配。可能数据库被移动到其它设备或 hostname 已变更，请在设置中重新填写 API Key".to_string()
    })?;
    String::from_utf8(plaintext).map_err(|_| "解密结果不是合法 UTF-8".to_string())
}

/// 保存（或覆盖）某 provider 的加密 apiKey。空字符串等价删除。
#[command]
pub fn secure_set_api_key(
    conn: State<DbConnection>,
    provider_id: String,
    key: String,
) -> Result<(), String> {
    if key.is_empty() {
        return secure_delete_api_key(conn, provider_id);
    }
    let device = device_id();
    let (enc, nonce) = encrypt_key(&device, &key)?;
    // device 不写入数据库：解密时重新按当前 hostname 派生，避免 hostname 变化后产生冗余记录。
    let now = chrono::Utc::now().to_rfc3339();
    let guard = conn
        .0
        .lock()
        .map_err(|_| "数据库连接锁已被污染".to_string())?;
    guard
        .execute(
            "INSERT INTO provider_secrets (provider_id, encrypted_key, nonce, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(provider_id) DO UPDATE SET encrypted_key = ?2, nonce = ?3, created_at = ?4",
            params![provider_id, enc, nonce, now],
        )
        .map_err(|e| format!("写入加密密钥失败: {}", e))?;
    Ok(())
}

/// 读取某 provider 的 apiKey（解密后）。不存在返回 None。
#[command]
pub fn secure_get_api_key(
    conn: State<DbConnection>,
    provider_id: String,
) -> Result<Option<String>, String> {
    let guard = conn
        .0
        .lock()
        .map_err(|_| "数据库连接锁已被污染".to_string())?;
    let stored: Option<(String, String)> = match guard.query_row(
        "SELECT encrypted_key, nonce FROM provider_secrets WHERE provider_id = ?1",
        params![provider_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ) {
        Ok(row) => Some(row),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(format!("读取加密密钥失败: {}", e)),
    };
    drop(guard);
    match stored {
        Some((enc, nonce)) => {
            let device = device_id();
            let plaintext = decrypt_key(&device, &enc, &nonce)?;
            Ok(Some(plaintext))
        }
        None => Ok(None),
    }
}

/// 删除某 provider 的 apiKey。
#[command]
pub fn secure_delete_api_key(
    conn: State<DbConnection>,
    provider_id: String,
) -> Result<(), String> {
    let guard = conn
        .0
        .lock()
        .map_err(|_| "数据库连接锁已被污染".to_string())?;
    guard
        .execute(
            "DELETE FROM provider_secrets WHERE provider_id = ?1",
            params![provider_id],
        )
        .map_err(|e| format!("删除加密密钥失败: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip_same_device() {
        let device = "unit-test-device";
        let secret = "sk-abc123DEF456密文也行";
        let (enc, nonce) = encrypt_key(device, secret).expect("加密失败");
        // 密文不应泄露明文
        assert!(!enc.contains("sk-abc"));
        let plain = decrypt_key(device, &enc, &nonce).expect("解密失败");
        assert_eq!(plain, secret);
    }

    #[test]
    fn decrypt_fails_on_different_device() {
        let (enc, nonce) = encrypt_key("device-A", "top-secret").expect("加密失败");
        let result = decrypt_key("device-B", &enc, &nonce);
        assert!(result.is_err(), "异机应无法解密");
    }

    #[test]
    fn decrypt_fails_on_tampered_ciphertext() {
        let device = "device-X";
        let (mut enc, nonce) = encrypt_key(device, "hello").expect("加密失败");
        // 篡改最后一个 base64 字符
        enc.pop();
        enc.push(if enc.ends_with('A') { 'B' } else { 'A' });
        let result = decrypt_key(device, &enc, &nonce);
        assert!(result.is_err(), "被篡改的密文应解密失败（GCM tag 校验）");
    }
}

