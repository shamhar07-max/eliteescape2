import { app } from "./app.js";

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => console.log(`Elite Escape Platform API listening on :${PORT}`));
