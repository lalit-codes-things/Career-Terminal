declare module 'blocked-at' {
  export default function (
    cb: (time: number, stack: string[]) => void,
    options?: { threshold?: number },
  ): void;
}
