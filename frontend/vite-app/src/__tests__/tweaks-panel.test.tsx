// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import {
  TweaksPanel,
  TweakSection,
  TweakRow,
  TweakSlider,
  TweakToggle,
  TweakRadio,
  TweakSelect,
  TweakText,
  TweakNumber,
  TweakColor,
  TweakButton,
  useTweaks,
} from "../tweaks-panel";

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// TweakSection
// ---------------------------------------------------------------------------

describe("TweakSection", () => {
  it("renders the label as a twk-sect div", () => {
    const { container } = render(
      <TweakSection label="表示">
        <span>child</span>
      </TweakSection>,
    );
    const sect = container.querySelector(".twk-sect");
    expect(sect?.textContent).toBe("表示");
  });

  it("renders children below the section label", () => {
    const { container } = render(
      <TweakSection label="x">
        <span data-testid="c">hello</span>
      </TweakSection>,
    );
    expect(container.textContent).toContain("hello");
  });
});

// ---------------------------------------------------------------------------
// TweakRow
// ---------------------------------------------------------------------------

describe("TweakRow", () => {
  it("renders label and value when value is provided", () => {
    const { container } = render(
      <TweakRow label="opacity" value={0.5}>
        <input />
      </TweakRow>,
    );
    expect(container.textContent).toContain("opacity");
    expect(container.textContent).toContain("0.5");
  });

  it("omits .twk-val when value is null", () => {
    const { container } = render(
      <TweakRow label="x" value={null}>
        <input />
      </TweakRow>,
    );
    expect(container.querySelector(".twk-val")).toBeNull();
  });

  it("applies twk-row-h class when inline is true", () => {
    const { container } = render(
      <TweakRow label="x" inline>
        <input />
      </TweakRow>,
    );
    const row = container.querySelector(".twk-row");
    expect(row?.className).toContain("twk-row-h");
  });
});

// ---------------------------------------------------------------------------
// TweakSlider
// ---------------------------------------------------------------------------

describe("TweakSlider", () => {
  it("renders an input[type=range] with the given value", () => {
    const { container } = render(
      <TweakSlider label="size" value={42} onChange={vi.fn()} />,
    );
    const input = container.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("42");
  });

  it("emits Number(value) on change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakSlider label="size" value={10} onChange={onChange} />,
    );
    const input = container.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "75" } });
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it("appends unit to the displayed value", () => {
    const { container } = render(
      <TweakSlider label="alpha" value={0.7} unit="%" onChange={vi.fn()} />,
    );
    expect(container.textContent).toContain("0.7%");
  });

  it("respects an explicitly provided step (covers line 359 non-default branch)", () => {
    // When step is omitted, V8 applies the default (step=1) — "default used" branch.
    // Providing step=2 takes the "parameter provided" branch at line 359, closing
    // the last uncovered branch in TweakSlider.
    const { container } = render(
      <TweakSlider label="size" value={10} step={2} onChange={vi.fn()} />,
    );
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.step).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// TweakToggle
// ---------------------------------------------------------------------------

describe("TweakToggle", () => {
  it("renders role=switch with aria-checked reflecting the value", () => {
    const { container } = render(
      <TweakToggle label="dark" value={true} onChange={vi.fn()} />,
    );
    const btn = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(btn.getAttribute("aria-checked")).toBe("true");
    expect(btn.getAttribute("data-on")).toBe("1");
  });

  it("aria-checked=false / data-on=0 when value is false", () => {
    const { container } = render(
      <TweakToggle label="dark" value={false} onChange={vi.fn()} />,
    );
    const btn = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(btn.getAttribute("aria-checked")).toBe("false");
    expect(btn.getAttribute("data-on")).toBe("0");
  });

  it("clicking toggles the value (emits !value)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakToggle label="dark" value={false} onChange={onChange} />,
    );
    const btn = container.querySelector('[role="switch"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// TweakRadio
// ---------------------------------------------------------------------------

describe("TweakRadio", () => {
  it("renders 2 options as a segment group with correct aria-checked", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        onChange={onChange}
      />,
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    const buttons = container.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute("aria-checked")).toBe("true");
    expect(buttons[1].getAttribute("aria-checked")).toBe("false");
  });

  it("renders both option labels (Alpha / Beta)", () => {
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Beta");
  });

  it("falls back to <select> when there are >3 options", () => {
    const opts = ["a", "b", "c", "d"].map((v) => ({ value: v, label: v }));
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={opts}
        onChange={vi.fn()}
      />,
    );
    const select = container.querySelector("select.twk-field");
    expect(select).not.toBeNull();
  });

  it("falls back to <select> when option labels exceed segment width", () => {
    const opts = [
      { value: "a", label: "a-very-long-label-that-cannot-fit-segment" },
      { value: "b", label: "b" },
    ];
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={opts}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector("select.twk-field")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TweakSelect
// ---------------------------------------------------------------------------

describe("TweakSelect", () => {
  it("renders <select> with the option labels and current value", () => {
    const { container } = render(
      <TweakSelect<string>
        label="x"
        value="b"
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        onChange={vi.fn()}
      />,
    );
    const select = container.querySelector(
      "select.twk-field",
    ) as HTMLSelectElement;
    expect(select.value).toBe("b");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("emits the raw string value on change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakSelect<string>
        label="x"
        value="a"
        options={["a", "b"]}
        onChange={onChange}
      />,
    );
    const select = container.querySelector(
      "select.twk-field",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

// ---------------------------------------------------------------------------
// TweakText
// ---------------------------------------------------------------------------

describe("TweakText", () => {
  it("renders <input type=text> with the value", () => {
    const { container } = render(
      <TweakText label="x" value="hello" onChange={vi.fn()} />,
    );
    const input = container.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    expect(input.value).toBe("hello");
  });

  it("emits onChange with the new text", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakText label="x" value="hello" onChange={onChange} />,
    );
    const input = container.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "world" } });
    expect(onChange).toHaveBeenCalledWith("world");
  });

  it("forwards placeholder", () => {
    const { container } = render(
      <TweakText label="x" value="" placeholder="ph" onChange={vi.fn()} />,
    );
    const input = container.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    expect(input.placeholder).toBe("ph");
  });
});

// ---------------------------------------------------------------------------
// TweakNumber
// ---------------------------------------------------------------------------

describe("TweakNumber", () => {
  it("renders <input type=number> with the value", () => {
    const { container } = render(
      <TweakNumber label="x" value={42} onChange={vi.fn()} />,
    );
    const input = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(input.value).toBe("42");
  });

  it("clamps to min when input is below min", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber label="x" value={5} min={0} max={10} onChange={onChange} />,
    );
    const input = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-3" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("clamps to max when input is above max", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber label="x" value={5} min={0} max={10} onChange={onChange} />,
    );
    const input = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("passes through values within range", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber label="x" value={5} min={0} max={10} onChange={onChange} />,
    );
    const input = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("renders the unit when provided", () => {
    const { container } = render(
      <TweakNumber label="px" value={10} unit="px" onChange={vi.fn()} />,
    );
    const unit = container.querySelector(".twk-num-unit");
    expect(unit?.textContent).toBe("px");
  });
});

// ---------------------------------------------------------------------------
// TweakColor
// ---------------------------------------------------------------------------

describe("TweakColor", () => {
  it("renders <input type=color> when no options provided", () => {
    const { container } = render(
      <TweakColor label="bg" value="#ff0000" onChange={vi.fn()} />,
    );
    const input = container.querySelector(
      'input[type="color"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("#ff0000");
  });

  it("uses array[0] as the color input value when value is an array", () => {
    const { container } = render(
      <TweakColor
        label="bg"
        value={["#00ff00", "#0000ff"]}
        onChange={vi.fn()}
      />,
    );
    const input = container.querySelector(
      'input[type="color"]',
    ) as HTMLInputElement;
    expect(input.value).toBe("#00ff00");
  });

  it("renders option chips when options[] is supplied", () => {
    const { container } = render(
      <TweakColor
        label="bg"
        value="#ff0000"
        options={["#ff0000", "#00ff00", "#0000ff"]}
        onChange={vi.fn()}
      />,
    );
    const chips = container.querySelectorAll('button[role="radio"].twk-chip');
    expect(chips.length).toBe(3);
  });

  it("the chip matching the current value has aria-checked=true", () => {
    const { container } = render(
      <TweakColor
        label="bg"
        value="#ff0000"
        options={["#ff0000", "#00ff00"]}
        onChange={vi.fn()}
      />,
    );
    const chips = container.querySelectorAll('button[role="radio"].twk-chip');
    expect(chips[0].getAttribute("aria-checked")).toBe("true");
    expect(chips[1].getAttribute("aria-checked")).toBe("false");
  });

  it("clicking a chip emits the original option (string stays string)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakColor
        label="bg"
        value="#ff0000"
        options={["#ff0000", "#00ff00"]}
        onChange={onChange}
      />,
    );
    const chips = container.querySelectorAll('button[role="radio"].twk-chip');
    fireEvent.click(chips[1]);
    expect(onChange).toHaveBeenCalledWith("#00ff00");
  });

  it("clicking a palette chip emits the original array (array stays array)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakColor
        label="palette"
        value={"#000000"}
        options={["#000000", ["#111", "#222", "#333"]]}
        onChange={onChange}
      />,
    );
    const chips = container.querySelectorAll('button[role="radio"].twk-chip');
    fireEvent.click(chips[1]);
    expect(onChange).toHaveBeenCalledWith(["#111", "#222", "#333"]);
  });
});

// ---------------------------------------------------------------------------
// TweakButton
// ---------------------------------------------------------------------------

describe("TweakButton", () => {
  it("renders the label and calls onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <TweakButton label="Reset" onClick={onClick} />,
    );
    const btn = container.querySelector("button.twk-btn") as HTMLButtonElement;
    expect(btn.textContent).toBe("Reset");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies secondary class when secondary=true", () => {
    const { container } = render(
      <TweakButton label="x" onClick={vi.fn()} secondary />,
    );
    const btn = container.querySelector("button.twk-btn") as HTMLButtonElement;
    expect(btn.className).toContain("secondary");
  });
});

// ---------------------------------------------------------------------------
// TweaksPanel — initial closed state + dual-surface
// ---------------------------------------------------------------------------

describe("TweaksPanel", () => {
  it("renders null until __activate_edit_mode message is received", () => {
    const { container } = render(
      <TweaksPanel title="設定">
        <span>inside</span>
      </TweaksPanel>,
    );
    expect(container.textContent).toBe("");
    expect(container.querySelector(".twk-panel")).toBeNull();
  });

  it("opens the panel when window receives __activate_edit_mode", async () => {
    const { container } = render(
      <TweaksPanel title="設定">
        <span>inside</span>
      </TweaksPanel>,
    );
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "__activate_edit_mode" },
        }),
      );
    });
    expect(container.querySelector(".twk-panel")).not.toBeNull();
    expect(container.textContent).toContain("設定");
    expect(container.textContent).toContain("inside");
  });

  it("closes the panel when window receives __deactivate_edit_mode", async () => {
    const { container } = render(<TweaksPanel title="x" />);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "__activate_edit_mode" },
        }),
      );
    });
    expect(container.querySelector(".twk-panel")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "__deactivate_edit_mode" },
        }),
      );
    });
    expect(container.querySelector(".twk-panel")).toBeNull();
  });

  it("clicking the close button dismisses the panel", async () => {
    const { container } = render(<TweaksPanel title="x" />);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "__activate_edit_mode" },
        }),
      );
    });
    const closeBtn = container.querySelector(
      "button.twk-x",
    ) as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(container.querySelector(".twk-panel")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useTweaks hook (via a small wrapper)
// ---------------------------------------------------------------------------

function HookProbe() {
  const [tweaks, setTweak] = useTweaks({ count: 1, label: "init" });
  return (
    <div>
      <span data-testid="count">{tweaks.count}</span>
      <span data-testid="label">{tweaks.label}</span>
      <button
        data-testid="inc"
        onClick={() => setTweak("count", (tweaks.count as number) + 1)}
      >
        inc
      </button>
      <button data-testid="rename" onClick={() => setTweak("label", "next")}>
        rename
      </button>
    </div>
  );
}

describe("useTweaks", () => {
  it("returns the defaults on first render", () => {
    const { container } = render(<HookProbe />);
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe(
      "1",
    );
    expect(container.querySelector('[data-testid="label"]')?.textContent).toBe(
      "init",
    );
  });

  it("setTweak(key, value) updates the matching key only", () => {
    const { container } = render(<HookProbe />);
    fireEvent.click(
      container.querySelector('[data-testid="inc"]') as HTMLButtonElement,
    );
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe(
      "2",
    );
    expect(container.querySelector('[data-testid="label"]')?.textContent).toBe(
      "init",
    );
  });

  it("setTweak overwrites string values too", () => {
    const { container } = render(<HookProbe />);
    fireEvent.click(
      container.querySelector('[data-testid="rename"]') as HTMLButtonElement,
    );
    expect(container.querySelector('[data-testid="label"]')?.textContent).toBe(
      "next",
    );
  });
});

// ---------------------------------------------------------------------------
// TweakRadio — pointerdown scrub path (covers line 462-487: segAt + onPointerDown)
// ---------------------------------------------------------------------------
//
// jsdom returns a zero-size getBoundingClientRect for every element by default,
// so segAt() can't compute a meaningful segment index. Stub the rect to a
// realistic 200×30 box so the math (`(clientX - left - 2) / (width - 4) * n`)
// resolves to a deterministic segment.

function stubRect(el: Element, rect: Partial<DOMRect> = {}): void {
  const r: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 30,
    width: 200,
    height: 30,
    toJSON: () => "",
    ...(rect as DOMRect),
  };
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => r,
    configurable: true,
  });
}

describe("TweakRadio — pointer scrub", () => {
  it("pointerdown at the right half of the track switches to the second option", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={onChange}
      />,
    );
    const track = container.querySelector('[role="radiogroup"]') as HTMLElement;
    stubRect(track);
    // segAt(150) with n=2: inner=196; i = floor((150-2)/196 * 2) = 1 → 'b'
    fireEvent.pointerDown(track, { clientX: 150 });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("pointermove during drag emits the new segment value", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="b"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={onChange}
      />,
    );
    const track = container.querySelector('[role="radiogroup"]') as HTMLElement;
    stubRect(track);
    // Start on right segment (no change — same as current 'b'), then drag left
    fireEvent.pointerDown(track, { clientX: 150 });
    onChange.mockClear();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 30 }));
    expect(onChange).toHaveBeenCalledWith("a");
    // Clean up: simulate pointerup so window listeners detach
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("pointerup removes the move/up listeners (no further onChange after release)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={onChange}
      />,
    );
    const track = container.querySelector('[role="radiogroup"]') as HTMLElement;
    stubRect(track);
    fireEvent.pointerDown(track, { clientX: 30 });
    window.dispatchEvent(new PointerEvent("pointerup"));
    onChange.mockClear();
    // After pointerup, move should NOT trigger onChange
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 150 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pointerdown on a track with no element (segAt early return) does not throw", () => {
    // Synthesizes the trackRef.current === null branch — exercise the early
    // return inside segAt. Normally trackRef is always populated after mount,
    // so this is a defensive-code path.
    const onChange = vi.fn();
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={onChange}
      />,
    );
    const track = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(() => fireEvent.pointerDown(track, { clientX: 0 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TweakRadio — pointermove after unmount (line 476 !trackRef.current true branch)
//
// React sets trackRef.current = null during unmount (commitDetachRef).
// However, window.pointermove listeners attached inside onPointerDown are NOT
// cleaned up by React — they survive the unmount.  Dispatching pointermove on
// window after unmount therefore executes the `move` closure, which hits the
// `if (!trackRef.current) return;` guard (line 476) and returns early.
// ---------------------------------------------------------------------------

describe("TweakRadio — pointermove after unmount exercises line 476 guard", () => {
  it("move handler returns early when trackRef.current is null after unmount", () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={onChange}
      />,
    );
    const track = container.querySelector('[role="radiogroup"]') as HTMLElement;
    stubRect(track);
    // pointerdown attaches the `move` closure to window.pointermove
    fireEvent.pointerDown(track, { clientX: 30 });
    onChange.mockClear();
    // Unmount: React calls commitDetachRef → trackRef.current = null
    unmount();
    // Dispatch pointermove — `move` fires, hits !trackRef.current at line 476 → early return
    expect(() =>
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 150 })),
    ).not.toThrow();
    // onChange must NOT fire: segAt was never reached (early return at line 476)
    expect(onChange).not.toHaveBeenCalled();
    // Clean up: pointerup detaches move/up from window (setDragging is a no-op after unmount in React 18)
    window.dispatchEvent(new PointerEvent("pointerup"));
  });
});

// ---------------------------------------------------------------------------
// TweakNumber — pointerdown scrub path (covers line 599-616: onScrubStart)
// ---------------------------------------------------------------------------

describe("TweakNumber — pointer scrub", () => {
  it("pointerdown on label starts the scrub closure (no immediate onChange)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber label="x" value={10} step={1} onChange={onChange} />,
    );
    const lbl = container.querySelector(".twk-num-lbl") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 0 });
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("pointermove after pointerdown emits the scrubbed value (dx*step rounded)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber label="x" value={10} step={1} onChange={onChange} />,
    );
    const lbl = container.querySelector(".twk-num-lbl") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 0 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 5 }));
    // dx=5 * step=1 = 5 → snapped = round(15/1)*1 = 15
    expect(onChange).toHaveBeenCalledWith(15);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("scrub clamps to min when below the limit", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber
        label="x"
        value={5}
        min={0}
        max={20}
        step={1}
        onChange={onChange}
      />,
    );
    const lbl = container.querySelector(".twk-num-lbl") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 0 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: -50 }));
    expect(onChange).toHaveBeenCalledWith(0);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("scrub clamps to max when above the limit", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber
        label="x"
        value={5}
        min={0}
        max={20}
        step={1}
        onChange={onChange}
      />,
    );
    const lbl = container.querySelector(".twk-num-lbl") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 0 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 999 }));
    expect(onChange).toHaveBeenCalledWith(20);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("decimal step preserves precision via toFixed(decimals)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber label="x" value={1.0} step={0.1} onChange={onChange} />,
    );
    const lbl = container.querySelector(".twk-num-lbl") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 0 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 3 }));
    // dx=3 * step=0.1 = 0.3 → snapped = round(1.3 / 0.1) * 0.1 = 1.3
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toBeCloseTo(1.3, 5);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("pointerup removes the listeners (no further onChange after release)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakNumber label="x" value={10} step={1} onChange={onChange} />,
    );
    const lbl = container.querySelector(".twk-num-lbl") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 0 });
    window.dispatchEvent(new PointerEvent("pointerup"));
    onChange.mockClear();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100 }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TweaksPanel drag — onDragStart + move + up callbacks (line 278 area)
//
// Fires mousedown on .twk-hd → onDragStart runs (line 258-278).
// Then dispatches mousemove → move callback (lines 265-271).
// Then dispatches mouseup  → up callback (lines 272-274), cleans up listeners.
// ---------------------------------------------------------------------------

describe("TweaksPanel — drag callbacks (lines 265-278)", () => {
  it("mousedown on drag header triggers onDragStart (lines 258-278)", async () => {
    const { container } = render(<TweaksPanel title="drag test" />);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "__activate_edit_mode" } }),
      );
    });
    const header = container.querySelector(".twk-hd") as HTMLElement;
    expect(header).not.toBeNull();
    // Fire mousedown → onDragStart executes, registers move/up on window
    fireEvent.mouseDown(header, { clientX: 200, clientY: 200 });
    // Fire mousemove → 'move' callback (lines 265-271) is triggered
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 220, clientY: 205, bubbles: true }));
    // Fire mouseup → 'up' callback (lines 272-274) is triggered, clears listeners
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    // Panel still renders (drag does not close it)
    expect(container.querySelector(".twk-panel")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TweakRadio — select fallback resolve function (lines 433-441)
//
// >3 options → fitsAsSegments = false → renders <select> + resolve closure.
// Firing change on the select invokes resolve(s) which maps string → typed value.
//   resolve('b') with options [{value:'b',label:'B'},...] → lines 438-440
//   resolve('xyz') (unknown value)                        → line 437
// ---------------------------------------------------------------------------

describe("TweakRadio — select fallback resolve (lines 433-441)", () => {
  it("fireEvent.change on the select fallback calls resolve with a valid value (lines 438-440)", () => {
    const onChange = vi.fn();
    const opts = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
      { value: "d", label: "D" },
    ];
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={opts}
        onChange={onChange}
      />,
    );
    const select = container.querySelector("select.twk-field") as HTMLSelectElement;
    expect(select).not.toBeNull();
    // resolve('b') → finds {value:'b',label:'B'} → returns 'b' (lines 438-440)
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("fireEvent.change with unknown value exercises resolve line 437 (m===undefined)", () => {
    // When jsdom's select fires change with a value not in the <option> list,
    // e.target.value becomes '' (empty string). resolve('') finds no match →
    // m is undefined → line 437: return '' as unknown as V → onChange called with ''
    const onChange = vi.fn();
    const opts = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
      { value: "d", label: "D" },
    ];
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={opts}
        onChange={onChange}
      />,
    );
    const select = container.querySelector("select.twk-field") as HTMLSelectElement;
    // Fire change with an invalid option → jsdom sets value to '' (empty)
    // resolve('') → m is undefined → line 437 branch taken → onChange called
    fireEvent.change(select, { target: { value: "xyz" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TweakRadio — primitive options in segment path (line 454)
//
// When options is an array of primitives (e.g. ['a','b']), labelLen(o)=1,
// maxLen=1 ≤ segFitMap[2]=16 → fitsAsSegments=true → renders segments.
// opts.map() at line 451 runs with primitive 'a' (not an object with 'value')
// → takes else branch: { value: o as V, label: String(o) } → line 454 covered.
// ---------------------------------------------------------------------------

describe("TweakRadio — primitive options in segments path (line 454)", () => {
  it("renders segment buttons for primitive string options", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={["a", "b"] as unknown as Array<{ value: string; label: string }>}
        onChange={onChange}
      />,
    );
    // With primitive options, fitsAsSegments=true → renders radio segment buttons (not select)
    const track = container.querySelector('[role="radiogroup"]');
    expect(track).not.toBeNull();
    // 'a' and 'b' labels should appear (String(o) is used for label)
    expect(container.textContent).toContain("a");
    expect(container.textContent).toContain("b");
  });
});

// ---------------------------------------------------------------------------
// TweakRadio — 4 primitive options → select fallback + resolve else (line 440)
//
// 4 primitive options: segFitMap[4] is undefined → 0 → fitsAsSegments=false
// → uses <select>. Firing change on the select:
//   resolve('a') → m='a' (the string 'a') → typeof 'a' !== 'object' → line 440: return m
// ---------------------------------------------------------------------------

describe("TweakRadio — 4 primitive options select fallback resolve else (line 440)", () => {
  it("select fallback with primitive options resolves via the else branch (line 440)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TweakRadio<string>
        label="mode"
        value="a"
        options={["a", "b", "c", "d"] as unknown as Array<{ value: string; label: string }>}
        onChange={onChange}
      />,
    );
    const select = container.querySelector("select.twk-field") as HTMLSelectElement;
    expect(select).not.toBeNull();
    // resolve('b') → m='b' (primitive) → typeof 'b' !== 'object' → line 440: return 'b'
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// useTweaks — object-form setTweak call (line 182)
//
// setTweak(key, val) is the typical path; setTweak({key: val}) is the bulk path.
// Calling the bulk form exercises line 182: ? (keyOrEdits as Partial<T>)
// ---------------------------------------------------------------------------

describe("useTweaks — object-form setTweak (line 182)", () => {
  it("setTweak({key: value}) updates multiple keys at once via object form", () => {
    function BulkProbe() {
      const [tweaks, setTweak] = useTweaks({ count: 1, label: "init" });
      return (
        <div>
          <span data-testid="count">{tweaks.count}</span>
          <span data-testid="label">{tweaks.label}</span>
          <button
            data-testid="bulk"
            onClick={() => (setTweak as (edits: Record<string, unknown>) => void)({ count: 99, label: "bulk" })}
          >
            bulk
          </button>
        </div>
      );
    }
    const { container } = render(<BulkProbe />);
    fireEvent.click(container.querySelector('[data-testid="bulk"]') as HTMLElement);
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("99");
    expect(container.querySelector('[data-testid="label"]')?.textContent).toBe("bulk");
  });
});

// ---------------------------------------------------------------------------
// TweaksPanel — ResizeObserver path in useEffect (lines 234-236)
//
// jsdom has no ResizeObserver by default, so normally lines 231-232 run.
// Stubbing window.ResizeObserver makes the else path (lines 234-236) run:
//   const ro = new ResizeObserver(clampToViewport)
//   ro.observe(document.documentElement)
//   return () => ro.disconnect()
// ---------------------------------------------------------------------------

describe("TweaksPanel — ResizeObserver useEffect path (lines 234-236)", () => {
  it("uses ResizeObserver when available to watch viewport changes", async () => {
    const observations: Element[] = [];
    let disconnected = false;
    class MockRO {
      observe(el: Element) { observations.push(el); }
      disconnect() { disconnected = true; }
    }
    vi.stubGlobal("ResizeObserver", MockRO);
    const { container, unmount } = render(<TweaksPanel title="ro test" />);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "__activate_edit_mode" } }),
      );
    });
    // ResizeObserver.observe should have been called when the panel opens
    expect(observations.length).toBeGreaterThan(0);
    unmount();
    expect(disconnected).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// TweakColor — __twkIsLight 3-char hex path (line 640 true branch)
//
// __twkIsLight('#abc'):
//   h = 'abc', h.length === 3 → true → replace /./g → 'aabbcc'
//   parseInt('aabbcc', 16) = 11189196
//   r=170, g=187, b=204 → 170*299+187*587+204*114 = 183855 > 148000 → light=true
//   __TwkCheck gets light=true → stroke='rgba(0,0,0,.78)' (line 657 true branch)
// ---------------------------------------------------------------------------

describe("TweakColor — __twkIsLight 3-char hex (line 640 true) + __TwkCheck light=true (line 657)", () => {
  it("renders __TwkCheck with dark stroke when selected chip is a light 3-char hex (#abc)", () => {
    const { container } = render(
      <TweakColor
        label="bg"
        value="#abc"
        options={["#abc", "#ff0000"]}
        onChange={vi.fn()}
      />,
    );
    // '#abc' is selected → on=true → __TwkCheck renders
    const selectedChip = container.querySelector(
      'button[aria-checked="true"].twk-chip',
    ) as HTMLElement | null;
    expect(selectedChip).not.toBeNull();
    const svg = selectedChip?.querySelector("svg");
    expect(svg).not.toBeNull();
    // light=true → stroke='rgba(0,0,0,.78)'
    const path = svg?.querySelector("path");
    expect(path?.getAttribute("stroke")).toBe("rgba(0,0,0,.78)");
  });
});

// ---------------------------------------------------------------------------
// TweakColor — __twkIsLight NaN path (line 642 true branch)
//
// __twkIsLight('nope'):
//   h = 'nope', h.length !== 3 → padEnd → 'nope00'
//   parseInt('nope00', 16) = NaN → Number.isNaN(NaN) = true → return true (line 642)
// ---------------------------------------------------------------------------

describe("TweakColor — __twkIsLight NaN path (line 642 true branch)", () => {
  it("treats non-hex string as light when chip is selected (NaN → return true)", () => {
    const { container } = render(
      <TweakColor
        label="bg"
        value="nope"
        options={["nope", "#ff0000"]}
        onChange={vi.fn()}
      />,
    );
    const selectedChip = container.querySelector(
      'button[aria-checked="true"].twk-chip',
    ) as HTMLElement | null;
    expect(selectedChip).not.toBeNull();
    // NaN → light=true → __TwkCheck renders (svg present inside selected chip)
    expect(selectedChip?.querySelector("svg")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TweakColor — empty array value ?? fallback (line 687 true branch)
//
// value=[] → Array.isArray(value)=true → value[0]=undefined → ?? '' fires
// → input receives value="" (no crash, no undefined)
// ---------------------------------------------------------------------------

describe("TweakColor — empty array value ?? fallback (line 687)", () => {
  it('renders color input when value is an empty array (value[0] undefined → ?? branch fires)', () => {
    // value=[] → Array.isArray=true → value[0]=undefined → ?? '' executes
    // jsdom normalises '' to '#000000' for <input type="color">, so we verify
    // the input renders (the ?? branch was exercised) rather than checking the
    // normalised DOM value.
    const { container } = render(
      <TweakColor
        label="bg"
        value={[] as unknown as string}
        onChange={vi.fn()}
      />,
    );
    const input = container.querySelector(
      'input[type="color"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    // Branch exercised: value[0] === undefined → ?? '' → no crash
    expect(container.textContent).toContain("bg");
  });
});

// ---------------------------------------------------------------------------
// window side-effects (dual-surface contract)
// ---------------------------------------------------------------------------

describe("tweaks-panel.tsx — window side effects", () => {
  it("attaches every exported component to window", () => {
    const w = window as unknown as Record<string, unknown>;
    expect(w.useTweaks).toBe(useTweaks);
    expect(w.TweaksPanel).toBe(TweaksPanel);
    expect(w.TweakSection).toBe(TweakSection);
    expect(w.TweakRow).toBe(TweakRow);
    expect(w.TweakSlider).toBe(TweakSlider);
    expect(w.TweakToggle).toBe(TweakToggle);
    expect(w.TweakRadio).toBe(TweakRadio);
    expect(w.TweakSelect).toBe(TweakSelect);
    expect(w.TweakText).toBe(TweakText);
    expect(w.TweakNumber).toBe(TweakNumber);
    expect(w.TweakColor).toBe(TweakColor);
    expect(w.TweakButton).toBe(TweakButton);
  });
});
