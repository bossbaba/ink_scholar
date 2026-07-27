import {
  ApiOutlined,
  CheckOutlined,
  DeleteOutlined,
  DesktopOutlined,
  EditOutlined,
  InfoCircleOutlined,
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SunOutlined,
} from "@ant-design/icons";
import {
  AutoComplete,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Menu,
  Modal,
  message,
  Popconfirm,
  Radio,
  Select,
  Tag,
} from "antd";
import { useState } from "react";
import { useAiStore } from "@/stores/useAiStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { AiProviderConfig } from "@/types";

const categories = [
  { key: "appearance", label: "外观", icon: <SunOutlined /> },
  { key: "editor", label: "编辑器", icon: <EditOutlined /> },
  { key: "ai", label: "AI 模型", icon: <RobotOutlined /> },
  { key: "about", label: "关于", icon: <InfoCircleOutlined /> },
];

function AppearanceSettings() {
  const settingsStore = useSettingsStore();
  return (
    <section>
      <h2 className="panel-title">外观</h2>
      <p className="panel-sub">主题与视觉呈现</p>
      <div className="setting-card">
        <div className="setting-row">
          <div>
            <div className="setting-row__label">主题模式</div>
            <div className="setting-row__hint">切换浅色或暗色界面，变更即时生效</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type={settingsStore.theme === "light" ? "primary" : "default"}
              icon={<SunOutlined />}
              onClick={() => settingsStore.setTheme("light")}
            >
              浅色
            </Button>
            <Button
              type={settingsStore.theme === "dark" ? "primary" : "default"}
              icon={<MoonOutlined />}
              onClick={() => settingsStore.setTheme("dark")}
            >
              暗色
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function EditorSettings() {
  const settingsStore = useSettingsStore();
  return (
    <section>
      <h2 className="panel-title">编辑器</h2>
      <p className="panel-sub">写作区排版与自动保存</p>
      <div className="setting-card">
        <div className="setting-row">
          <div>
            <div className="setting-row__label">正文字体</div>
            <div className="setting-row__hint">编辑器中正文使用的字体族</div>
          </div>
          <Select
            value={settingsStore.editorFontFamily}
            onChange={(v) => settingsStore.setEditorFontFamily(v)}
            style={{ width: 200 }}
          >
            <Select.Option value="serif">衬线体 · Noto Serif SC</Select.Option>
            <Select.Option value="sans">无衬线 · Inter</Select.Option>
            <Select.Option value="kai">楷体 · KaiTi</Select.Option>
            <Select.Option value="system">系统默认</Select.Option>
          </Select>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-row__label">字体大小</div>
            <div className="setting-row__hint">正文字号，范围 12–24 像素</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <InputNumber
              min={12}
              max={24}
              value={settingsStore.editorFontSize}
              onChange={(v) => v && settingsStore.setEditorFontSize(v)}
            />
            <span style={{ color: "var(--c-text-3)" }}>px</span>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-row__label">自动保存间隔</div>
            <div className="setting-row__hint">后台定时保存当前章节进度</div>
          </div>
          <Select
            value={settingsStore.autoSaveInterval}
            onChange={(v) => settingsStore.setAutoSaveInterval(v)}
            style={{ width: 200 }}
          >
            <Select.Option value={10000}>10 秒</Select.Option>
            <Select.Option value={30000}>30 秒</Select.Option>
            <Select.Option value={60000}>1 分钟</Select.Option>
            <Select.Option value={300000}>5 分钟</Select.Option>
          </Select>
        </div>
      </div>
    </section>
  );
}

function AiProviderSettings() {
  const aiStore = useAiStore();
  const settingsStore = useSettingsStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [modelHint, setModelHint] = useState("");

  const emptyProvider = (): AiProviderConfig => ({
    provider: "ollama",
    name: "",
    baseUrl: "http://localhost:11434",
    apiKey: "",
    defaultModel: "",
    availableModels: [],
  });

  const openAdd = () => {
    setEditingIndex(null);
    form.setFieldsValue(emptyProvider());
    setModelHint("");
    setDialogOpen(true);
  };

  const openEdit = (index: number) => {
    setEditingIndex(index);
    const p = JSON.parse(JSON.stringify(aiStore.providers[index]));
    form.setFieldsValue(p);
    setModelHint(
      p.availableModels?.length
        ? `已缓存 ${p.availableModels.length} 个可用模型`
        : "点击「获取模型」拉取列表",
    );
    setDialogOpen(true);
  };

  const fetchModels = async () => {
    const vals = form.getFieldsValue();
    if (!vals.baseUrl) {
      message.warning("请先填写 API 地址");
      return;
    }
    setLoadingModels(true);
    setModelHint("");
    try {
      const models = await aiStore.listModels({ ...vals, name: vals.name || "" });
      form.setFieldsValue({ availableModels: models });
      setModelHint(`已加载 ${models.length} 个模型`);
      message.success(`已获取 ${models.length} 个模型`);
    } catch (e) {
      setModelHint(`获取失败：${e instanceof Error ? e.message : String(e)}`);
      message.error(`获取模型失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingModels(false);
    }
  };

  const testConn = async () => {
    const vals = form.getFieldsValue();
    if (!vals.baseUrl) {
      message.warning("请先填写 API 地址");
      return;
    }
    setTesting(true);
    try {
      const ok = await aiStore.testConnection({ ...vals, name: vals.name || "" });
      ok ? message.success("连接成功") : message.error("连接失败");
    } catch (e) {
      message.error(`连接测试失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const vals = form.getFieldsValue() as AiProviderConfig;
    if (!(vals.name && vals.baseUrl && vals.defaultModel)) {
      message.warning("请填写完整信息");
      return;
    }
    try {
      if (editingIndex === null) {
        if (aiStore.providers.some((p) => p.name === vals.name)) {
          message.error("已存在同名 Provider");
          return;
        }
        await aiStore.addProvider(vals);
        message.success("Provider 添加成功");
      } else {
        await aiStore.updateProvider(editingIndex, vals);
        message.success("Provider 已保存");
      }
      setDialogOpen(false);
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (index: number) => {
    try {
      await aiStore.removeProvider(index);
      message.success("Provider 已删除");
    } catch (e) {
      message.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const getGradient = (type: string) =>
    type === "ollama"
      ? "linear-gradient(135deg, #2FAEFF, #78C9FF)"
      : "linear-gradient(135deg, #E0A64E, #EFC483)";

  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2 className="panel-title">AI 模型</h2>
          <p className="panel-sub">管理本地或云端的大语言模型连接</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          添加 Provider
        </Button>
      </div>

      {/* AI 生成参数（全局，对所有 Provider 生效） */}
      <div className="setting-card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontWeight: 600, color: "var(--c-text-1)", marginBottom: 4 }}>生成参数</h3>
        <p style={{ fontSize: 14, color: "var(--c-text-3)", marginBottom: 8 }}>
          以下参数对所有 AI Provider 生效
        </p>
        <div className="setting-row">
          <div>
            <div className="setting-row__label">温度（Temperature）</div>
            <div className="setting-row__hint">越高越发散有创意，越低越稳定可控（0–2）</div>
          </div>
          <InputNumber
            min={0}
            max={2}
            step={0.1}
            value={settingsStore.aiTemperature}
            onChange={(v) => typeof v === "number" && settingsStore.setAiTemperature(v)}
            style={{ width: 120 }}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-row__label">最大生成长度（Max Tokens）</div>
            <div className="setting-row__hint">单次回复的上限（256–8192）</div>
          </div>
          <InputNumber
            min={256}
            max={8192}
            step={256}
            value={settingsStore.aiMaxTokens}
            onChange={(v) => typeof v === "number" && settingsStore.setAiMaxTokens(v)}
            style={{ width: 120 }}
          />
        </div>
      </div>

      {aiStore.providers.length === 0 ? (
        <div className="empty-box">
          <Empty
            description={
              <>
                <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
                  还没有配置 AI Provider
                </p>
                <p style={{ color: "var(--c-text-4)", marginBottom: 16 }}>
                  添加 Ollama 或 OpenAI 兼容的 Provider 开始使用 AI 功能
                </p>
              </>
            }
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            添加 Provider
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {aiStore.providers.map((provider, index) => (
            <div
              key={provider.name}
              className={`prov-item ${aiStore.activeProvider?.name === provider.name ? "prov-item--active" : ""}`}
            >
              <Button
                type="text"
                shape="circle"
                icon={
                  aiStore.activeProvider?.name === provider.name ? (
                    <CheckOutlined style={{ color: "var(--c-primary-500)" }} />
                  ) : undefined
                }
                onClick={() => {
                  aiStore.setActiveProvider(provider);
                  message.success(`已切换为「${provider.name}」`);
                }}
              />
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  background: getGradient(provider.provider),
                }}
              >
                <DesktopOutlined style={{ fontSize: 22, color: "white" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>{provider.name}</span>
                  <Tag>{provider.provider === "ollama" ? "Ollama" : "OpenAI 兼容"}</Tag>
                  {aiStore.activeProvider?.name === provider.name && (
                    <Tag color="blue">当前使用</Tag>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--c-text-3)" }}>{provider.baseUrl}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--c-text-4)" }}>默认模型:</span>
                  <span style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
                    {provider.defaultModel || "未设置"}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="small"
                  icon={<ApiOutlined />}
                  onClick={async () => {
                    const ok = await aiStore.testConnection(provider);
                    ok ? message.success("连接成功") : message.error("连接失败");
                  }}
                >
                  测试
                </Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(index)}>
                  编辑
                </Button>
                <Popconfirm
                  title={`确定删除「${provider.name}」吗？`}
                  onConfirm={() => remove(index)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={editingIndex === null ? "添加 AI Provider" : "编辑 AI Provider"}
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onOk={save}
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="例如：Ollama、通义千问" />
          </Form.Item>
          <Form.Item label="类型" name="provider" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="ollama">Ollama</Radio>
              <Radio value="openai_compat">OpenAI 兼容</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="API 地址" name="baseUrl" rules={[{ required: true }]}>
            <Input placeholder="http://localhost:11434" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.provider !== cur.provider}>
            {({ getFieldValue }) =>
              getFieldValue("provider") === "openai_compat" && (
                <Form.Item label="API Key" name="apiKey">
                  <Input.Password placeholder="输入 API Key" />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item label="默认模型" required>
            <Form.Item noStyle dependencies={["availableModels"]}>
              {({ getFieldValue }) => {
                const models = (getFieldValue("availableModels") || []) as string[];
                return (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Form.Item
                      name="defaultModel"
                      noStyle
                      rules={[{ required: true, message: "请选择或输入模型" }]}
                    >
                      <AutoComplete
                        placeholder={
                          models.length
                            ? "选择或输入模型"
                            : "点击右侧「获取模型」拉取列表"
                        }
                        options={models.map((m) => ({ label: m, value: m }))}
                        style={{ flex: 1 }}
                        allowClear
                        filterOption={false}
                      />
                    </Form.Item>
                    <Button icon={<ReloadOutlined />} loading={loadingModels} onClick={fetchModels}>
                      获取模型
                    </Button>
                  </div>
                );
              }}
            </Form.Item>
          </Form.Item>
          {modelHint && (
            <div style={{ fontSize: 13, color: "var(--c-text-3)", marginTop: -8 }}>{modelHint}</div>
          )}
        </Form>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Button icon={<ApiOutlined />} loading={testing} onClick={testConn}>
            测试连接
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function AboutSettings() {
  return (
    <section>
      <h2 className="panel-title">关于</h2>
      <p className="panel-sub">Ink Scholar · AI 写作助手</p>
      <div className="setting-card">
        <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "linear-gradient(135deg, var(--c-primary-500), var(--c-primary-700))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              fontWeight: 700,
              color: "white",
              fontFamily: "var(--font-serif)",
            }}
          >
            墨
          </div>
          <div>
            <h3 style={{ fontSize: 20, fontWeight: 600, fontFamily: "var(--font-serif)" }}>
              Ink Scholar
            </h3>
            <p style={{ color: "var(--c-text-3)" }}>让 AI 成为你的创作伙伴</p>
          </div>
          <Tag>v1.0.0</Tag>
        </div>
        {[
          { label: "应用版本", value: "v1.0.0" },
          { label: "数据目录", desc: "作品与配置存储位置", value: "~/Documents/InkScholar" },
          { label: "本地数据库", value: "ink_scholar.db" },
        ].map((row) => (
          <div key={row.label} className="setting-row">
            <div>
              <div className="setting-row__label">{row.label}</div>
              {row.desc && <div className="setting-row__hint">{row.desc}</div>}
            </div>
            <code
              style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--c-text-3)" }}
            >
              {row.value}
            </code>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Settings() {
  const [activeCategory, setActiveCategory] = useState("appearance");

  return (
    <div className="ui-page">
      <div className="ui-page__inner">
        <header className="page-head">
          <div>
            <p className="page-eyebrow">偏好与配置</p>
            <h1 className="page-title">设置</h1>
          </div>
        </header>

        <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
          <div style={{ width: 200, flexShrink: 0 }}>
            <Menu
              mode="inline"
              selectedKeys={[activeCategory]}
              onClick={({ key }) => setActiveCategory(key)}
              items={categories}
              style={{ border: "none", background: "transparent" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fade-in">
              {activeCategory === "appearance" && <AppearanceSettings />}
              {activeCategory === "editor" && <EditorSettings />}
              {activeCategory === "ai" && <AiProviderSettings />}
              {activeCategory === "about" && <AboutSettings />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
