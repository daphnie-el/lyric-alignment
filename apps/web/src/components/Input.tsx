import {
  forwardRef,
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** A message to display below the input, or true for the error style alone. */
  error?: boolean | string;
  /** Allow digits only, including when pasting. */
  numbersOnly?: boolean;
}

function digitsOnly(value: InputProps["value"]): string {
  return String(value ?? "").replace(/\D/g, "");
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    error,
    numbersOnly = false,
    className,
    id,
    type = "text",
    inputMode,
    placeholder,
    value,
    defaultValue,
    onChange,
    "aria-describedby": describedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorMessage = typeof error === "string" ? error : undefined;
  const errorId = errorMessage ? `${inputId}-error` : undefined;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (numbersOnly) {
      const input = event.currentTarget;
      const original = input.value;
      const cursor = input.selectionStart ?? original.length;
      const position = digitsOnly(original.slice(0, cursor)).length;
      input.value = digitsOnly(original);
      input.setSelectionRange(position, position);
    }
    onChange?.(event);
  }

  return (
    <span className="input-field">
      <input
        {...props}
        ref={ref}
        id={inputId}
        className={className ? `input ${className}` : "input"}
        type={numbersOnly ? "text" : type}
        inputMode={numbersOnly ? "numeric" : inputMode}
        placeholder={placeholder}
        value={numbersOnly && value !== undefined ? digitsOnly(value) : value}
        defaultValue={numbersOnly && defaultValue !== undefined
          ? digitsOnly(defaultValue)
          : defaultValue}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={[describedBy, errorId].filter(Boolean).join(" ") || undefined}
        onChange={handleChange}
      />
      {errorMessage ? (
        <span id={errorId} className="input-error" role="alert">
          {errorMessage}
        </span>
      ) : null}
    </span>
  );
});
