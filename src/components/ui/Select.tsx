import { forwardRef } from "react";

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = "", ...props },
  ref
) {
  return <select ref={ref} className={`select ${className}`.trim()} {...props} />;
});