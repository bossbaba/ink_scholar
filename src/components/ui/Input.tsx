import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, id, ...rest }: InputProps) {
  const inputId = id ?? rest.name;
  return (
    <label className="ui-field" htmlFor={inputId}>
      {label ? <span className="ui-field__label">{label}</span> : null}
      <input id={inputId} className={`ui-input ${className ?? ""}`} {...rest} />
    </label>
  );
}
