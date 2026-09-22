type Middleware = (req: any, res: any, next: () => void) => void;
const passthrough = (): Middleware => (_req, _res, next) => next();
export const json = passthrough;
export const raw = passthrough;
export const text = passthrough;
export const urlencoded = passthrough;
export default { json, raw, text, urlencoded };
