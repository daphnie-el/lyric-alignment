import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../components/Button";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";

const storageKey = "lyric-alignment:walkthrough:v1";
const steps = [
  {
    target: "add-lyrics",
    title: "Add lyrics",
    text: "The sample song already includes lyrics. For your own lyrics, paste text into the lyric sheet. Add all lines creates one lyric per line and skips blank lines. + Add line keeps the whole entry as one lyric.",
  },
  {
    target: "playback",
    title: "Play the song",
    text: "Use Play to listen to the song before placing lyrics. Pause or Stop whenever you need to listen again.",
  },
  {
    target: "stamp",
    title: "Time each lyric",
    text: "Select a lyric, play the song, and press Space or choose Set lyric start time when that lyric begins. Each successful stamp advances to the next lyric in the sheet. Use Space while focus is outside buttons and text fields.",
  },
  {
    target: "adjust",
    title: "Adjust timings",
    text: "Drag a segment to move it or pull an edge to resize it. Shift-click segments to select a group, then drag one to move them together. Use Undo to reverse a mistake.",
  },
  {
    target: "merge",
    inspector: true,
    title: "Merge lyrics",
    text: "The first lyric is selected to show its inspector controls. Merge combines the selected lyric with the next lyric, including their timing when present. It is unavailable on the last lyric. This tour only explains the action; it does not merge anything.",
  },
  {
    target: "split",
    inspector: true,
    title: "Split a lyric",
    text: "Split divides the selected lyric at a word boundary you choose. For a timed lyric, also choose a split timestamp within its segment. A lyric needs at least three words to split; a timed segment also needs room for two parts.",
  },
  {
    target: "remove-segment",
    inspector: true,
    title: "Remove a segment",
    text: "Remove Segment clears the selected lyric’s timing and keeps the lyric in the sheet. You can then time that lyric again. If the lyric is already untimed, there is no timing to remove.",
  },
  {
    target: "delete",
    inspector: true,
    title: "Delete a lyric",
    text: "Delete removes the selected lyric from the sheet together with its timing. Use Undo to recover an accidental deletion. Your lyrics stay unchanged throughout this tour.",
  },
  {
    target: "save",
    title: "Save your changes",
    text: "Edits need saving. Choose Save alignment to keep your lyrics and timings. This button becomes available when you have unsaved changes.",
  },
  {
    target: "export",
    title: "Export timed lyrics",
    text: "Export LRC downloads your timed lyrics as an .lrc file. Untimed lines are left out. To work on another song, choose Load song and supply your audio, then add its lyrics.",
  },
] as const;

function readDismissed() {
  try {
    return localStorage.getItem(storageKey) === "dismissed";
  } catch {
    return false;
  }
}

export default function EditorWalkthrough() {
  const { status, track, importDialogOpen, importing, saving, interacting } = useEditorState();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [requested, setRequested] = useState(false);
  const helpRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useCallback(() => helpRef.current?.focus(), []);
  const available =
    status === "ready" && !!track && !importDialogOpen && !importing && !saving && !interacting;
  const open = available && (requested || !dismissed);

  function close() {
    setDismissed(true);
    setRequested(false);
    try {
      localStorage.setItem(storageKey, "dismissed");
    } catch {
      /* Session dismissal still works. */
    }
  }

  return (
    <>
      <Button
        ref={helpRef}
        aria-describedby={!available ? "tour-unavailable" : undefined}
        onClick={() => setRequested(true)}
      >
        Help
      </Button>
      {!available ? (
        <span
          id="tour-unavailable"
          role={requested ? "status" : undefined}
          className={requested ? "tour-unavailable" : "sr-only"}
        >
          Load a song and wait for the current operation to finish to start the walkthrough.
        </span>
      ) : null}
      {open ? <Walkthrough onClose={close} returnFocus={returnFocus} /> : null}
    </>
  );
}

function Walkthrough({
  onClose,
  returnFocus,
}: {
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { track, selectedLineId, selectedTimelineIds } = useEditorState();
  const dispatch = useEditorDispatch();
  const [originalSelection] = useState(() => ({
    trackId: track!.id, selectedLineId, selectedTimelineIds,
  }));
  const [index, setIndex] = useState(0);
  const [spotlight, setSpotlight] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const firstLineId = track?.lines[0]?.id;
  const visibleSteps = firstLineId ? steps : steps.filter((step) => !("inspector" in step));
  const step = visibleSteps[index];
  const inspectorActive = "inspector" in step;
  const inspectorReady = !inspectorActive || (selectedLineId === firstLineId && selectedTimelineIds.length <= 1);
  const { refs, floatingStyles } = useFloating({
    placement: "bottom",
    strategy: "fixed",
    middleware: [offset(16), flip(), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  });
  const { setReference, setFloating } = refs;

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    document.body.classList.add("tour-active");
    return () => {
      dialog.close();
      document.body.classList.remove("tour-active");
      returnFocus();
    };
  }, [returnFocus]);

  useLayoutEffect(() => {
    if (!inspectorActive || !firstLineId) return;
    dispatch({ type: "selectLine", id: firstLineId });
    return () => dispatch({ type: "restoreSelection", ...originalSelection });
  }, [inspectorActive, firstLineId, dispatch, originalSelection]);

  useLayoutEffect(() => {
    if (!inspectorReady) return;
    const target = document.querySelector<HTMLElement>(
      `[data-tour="${step.target}"]`,
    );
    if (!target) return;
    setReference(target);
    function scrollToTarget() {
      if (window.matchMedia("(max-width: 640px)").matches) {
        window.scrollBy({
          top: target!.getBoundingClientRect().top - 24,
          behavior: "instant",
        });
      } else {
        target!.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
      }
    }
    scrollToTarget();
    const cleanup = autoUpdate(target, dialogRef.current!, () => {
      const rect = target.getBoundingClientRect();
      setSpotlight({
        top: rect.top - 5,
        left: rect.left - 5,
        width: rect.width + 10,
        height: rect.height + 10,
      });
    });
    window.addEventListener("resize", scrollToTarget);
    nextRef.current?.focus({ preventScroll: true });
    return () => {
      cleanup();
      window.removeEventListener("resize", scrollToTarget);
    };
  }, [step, setReference, inspectorReady]);

  // Native modality blocks pointer access; stop editor shortcuts before they reach window listeners.
  useEffect(() => {
    const dialog = dialogRef.current!;
    const stop = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", stop);
    return () => dialog.removeEventListener("keydown", stop);
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="tour-dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="tour-spotlight"
        data-tour-highlight={step.target}
        style={spotlight}
        aria-hidden="true"
      />
      <div ref={setFloating} className="tour-card" style={floatingStyles}>
        <p className="tour-progress" aria-live="polite">
          Step {index + 1} of {visibleSteps.length}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-description">{step.text}</p>
        <div className="tour-actions">
          <Button onClick={onClose}>Skip</Button>
          <span className="tour-actions-spacer" />
          <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Back
          </Button>
          <Button
            ref={nextRef}
            color="primary"
            onClick={() =>
              index === visibleSteps.length - 1 ? onClose() : setIndex(index + 1)
            }
          >
            {index === visibleSteps.length - 1 ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
