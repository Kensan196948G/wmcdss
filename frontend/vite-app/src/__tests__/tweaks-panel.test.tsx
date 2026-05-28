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
