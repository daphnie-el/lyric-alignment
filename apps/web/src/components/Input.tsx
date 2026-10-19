import {
  forwardRef,
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string;
  numbersOnly?: boolean;
  timeOnly?: boolean;
}

const PARTIAL_TIME_REGEX = /^\d*(?::[0-5]?\d?(?:\.\d{0,3})?)?$/;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    error,
    numbersOnly = false,
    timeOnly = false,
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
    if (timeOnly) {
      if (!PARTIAL_TIME_REGEX.test(event.currentTarget.value)) {
        return;
      }
    } else if (numbersOnly) {
      event.currentTarget.value = event.currentTarget.value.replace(
        /[^\d.]/g,
        "",
      );
    }

    onChange?.(event);
  }

  const isRestricted = numbersOnly || timeOnly;

  return (
    <span className="input-field">
      <input
        {...props}
        ref={ref}
        id={inputId}
        className={className ? `input ${className}` : "input"}
        type={isRestricted ? "text" : type}
        inputMode={numbersOnly ? "decimal" : inputMode}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={
          [describedBy, errorId].filter(Boolean).join(" ") || undefined
        }
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
