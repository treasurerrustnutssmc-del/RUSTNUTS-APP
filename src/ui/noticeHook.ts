/**
 * Where an error Notice reports that it showed, for the board's App usage counts. src/data/usage.ts
 * sets it; kept in its own file so the shared UI never imports the data layer.
 */
export const noticeErrors: { report: (message: string) => void } = { report: () => undefined };
