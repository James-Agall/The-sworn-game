// Vite's ?raw imports (the Area tab reads client/src/interior.ts's art tables from its text).
declare module "*?raw" {
  const text: string;
  export default text;
}
