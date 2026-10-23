import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from "@floating-ui/react";
import { forwardRef, useId, useState } from "react";
import { Button, type ButtonProps } from "./Button";

type TooltipButtonProps = Omit<ButtonProps, "title"> & {
  tooltip: string;
  wrapperClassName?: string;
};

export const TooltipButton = forwardRef<HTMLButtonElement, TooltipButtonProps>(function TooltipButton({
  tooltip,
  wrapperClassName,
  "aria-describedby": describedBy,
  ...props
}, ref) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const { refs: { setReference, setFloating }, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, {
    delay: { open: 400 },
    move: false,
    handleClose: safePolygon(),
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context, { referencePress: true });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);

  return (
    <>
      <span
        ref={setReference}
        className={wrapperClassName ? `inline-flex ${wrapperClassName}` : "inline-flex"}
        {...getReferenceProps()}
      >
        <Button
          {...props}
          ref={ref}
          aria-describedby={
            [describedBy, open ? tooltipId : undefined].filter(Boolean).join(" ") || undefined
          }
        />
      </span>
      {open ? (
        <FloatingPortal>
          <div
            ref={setFloating}
            id={tooltipId}
            role="tooltip"
            className="tooltip"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {tooltip}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
});
