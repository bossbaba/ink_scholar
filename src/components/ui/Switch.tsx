import { useId } from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  const id = useId();
  return (
    <label className="ui-switch-row" htmlFor={id}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ?? "开关"}
        className={`ui-switch ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-switch__thumb" />
      </button>
      {label ? <span className="ui-switch__label">{label}</span> : null}
    </label>
  );
}
