import { describe, expect, it } from "vitest";

import { cleanStrings, stripControlChars } from "@/src/pipeline/text-clean";

describe("stripControlChars", () => {
  it("removes NUL character", () => {
    expect(stripControlChars("hello\u0000world")).toBe("helloworld");
  });

  it("removes bell character (\\u0007)", () => {
    expect(stripControlChars("hello\u0007world")).toBe("helloworld");
  });

  it("keeps tab, newline and carriage return", () => {
    expect(stripControlChars("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("keeps ordinary text unchanged", () => {
    expect(stripControlChars("Hello, World!")).toBe("Hello, World!");
  });

  it("keeps accented text unchanged", () => {
    expect(stripControlChars("café résumé naïve")).toBe("café résumé naïve");
  });

  it("keeps emoji unchanged", () => {
    expect(stripControlChars("Hello 👋 World 🌍")).toBe("Hello 👋 World 🌍");
  });

  it("removes multiple control characters", () => {
    expect(stripControlChars("a\u0000b\u0007c\u0008d")).toBe("abcd");
  });

  it("removes DEL character (\\u007F)", () => {
    expect(stripControlChars("hello\u007Fworld")).toBe("helloworld");
  });

  it("removes other C0 controls like vertical tab and form feed", () => {
    expect(stripControlChars("a\u000Bb\u000Cc")).toBe("abc");
  });
});

describe("cleanStrings", () => {
  it("cleans strings in a plain object", () => {
    const input = { name: "hello\u0000world", count: 5 };
    const result = cleanStrings(input);
    expect(result).toEqual({ name: "helloworld", count: 5 });
  });

  it("cleans strings in nested objects", () => {
    const input = { outer: { inner: "a\u0000b" } };
    const result = cleanStrings(input);
    expect(result).toEqual({ outer: { inner: "ab" } });
  });

  it("cleans strings in arrays", () => {
    const input = ["hello\u0000", "world\u0007"];
    const result = cleanStrings(input);
    expect(result).toEqual(["hello", "world"]);
  });

  it("cleans strings in nested arrays", () => {
    const input = [["a\u0000b"], ["c\u0007d"]];
    const result = cleanStrings(input);
    expect(result).toEqual([["ab"], ["cd"]]);
  });

  it("cleans strings in objects inside arrays", () => {
    const input = [{ label: "a\u0000b", amount: 0 }];
    const result = cleanStrings(input);
    expect(result).toEqual([{ label: "ab", amount: 0 }]);
  });

  it("keeps Date instances unchanged", () => {
    const date = new Date(0);
    const input = { at: date, name: "test\u0000" };
    const result = cleanStrings(input);
    expect(result.at).toBe(date);
    expect(result.name).toBe("test");
  });

  it("keeps numbers unchanged", () => {
    const input = { amount: 123.45, count: 0 };
    const result = cleanStrings(input);
    expect(result).toEqual({ amount: 123.45, count: 0 });
  });

  it("keeps booleans unchanged", () => {
    const input = { active: true, deleted: false };
    const result = cleanStrings(input);
    expect(result).toEqual({ active: true, deleted: false });
  });

  it("keeps null and undefined unchanged", () => {
    const input = { a: null, b: undefined, c: "test\u0000" };
    const result = cleanStrings(input);
    expect(result.a).toBeNull();
    expect(result.b).toBeUndefined();
    expect(result.c).toBe("test");
  });

  it("does not mutate the input", () => {
    const input = { name: "hello\u0000world" };
    const original = { ...input };
    cleanStrings(input);
    expect(input).toEqual(original);
  });

  it("returns a new object, not the same reference", () => {
    const input = { name: "test" };
    const result = cleanStrings(input);
    expect(result).not.toBe(input);
  });

  it("handles complex nested structure with prices", () => {
    const input = {
      prices: [{ label: "a\u0000b", amount: 0 }],
      at: new Date(0),
      title: "Test\u0007Event",
    };
    const result = cleanStrings(input);
    expect(result).toEqual({
      prices: [{ label: "ab", amount: 0 }],
      at: input.at,
      title: "TestEvent",
    });
    expect(result.at).toBe(input.at);
  });

  it("handles objects with null prototype", () => {
    const input = Object.create(null);
    input.name = "test\u0000";
    const result = cleanStrings(input);
    expect(result.name).toBe("test");
  });

  it("does not walk non-plain objects", () => {
    class MyClass {
      constructor(public value: string) {}
    }
    const instance = new MyClass("test\u0000");
    const input = { instance };
    const result = cleanStrings(input);
    // Non-plain objects are returned as-is
    expect(result.instance).toBe(instance);
  });
});
