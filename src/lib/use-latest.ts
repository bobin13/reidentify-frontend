import { useLayoutEffect, useRef } from "react";

// A ref that always holds the latest committed `value`, for async callbacks
// that must check "is this still the same account/screen?" after awaiting.
// Writing `ref.current = value` during render instead makes React Compiler
// skip the whole component. Layout effects run before any passive effect or
// native event of the same commit, so readers never see a stale value.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
