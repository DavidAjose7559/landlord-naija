import { describe, expect, it } from "vitest";
import { dollars, formatCAD } from "./money";

describe("formatCAD", () => {
  it("formats whole dollars with no decimals", () => {
    expect(formatCAD(150000)).toBe("$1,500");
  });

  it("formats fractional cents with 2 decimal places", () => {
    expect(formatCAD(150050)).toBe("$1,500.50");
  });

  it("formats zero", () => {
    expect(formatCAD(0)).toBe("$0");
  });

  it("formats small whole amounts", () => {
    expect(formatCAD(100)).toBe("$1");
  });

  it("formats negative amounts", () => {
    expect(formatCAD(-150000)).toBe("-$1,500");
  });

  it("adds thousands separators for large amounts", () => {
    expect(formatCAD(123456789)).toBe("$1,234,567.89");
  });

  it("rounds a single trailing cent correctly", () => {
    expect(formatCAD(1001)).toBe("$10.01");
  });
});

describe("dollars", () => {
  it("converts whole dollars to integer cents", () => {
    expect(dollars(15)).toBe(1500);
  });

  it("converts zero", () => {
    expect(dollars(0)).toBe(0);
  });

  it("converts negative dollars", () => {
    expect(dollars(-5)).toBe(-500);
  });
});
