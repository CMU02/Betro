import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderThemeCss } from "../theme/render-theme-css";

writeFileSync(
	join(import.meta.dir, "../theme/theme.generated.css"),
	renderThemeCss()
);
