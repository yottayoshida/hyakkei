// See validate-dashboard.d.ts (same directory) for why this stub exists and
// what it stands in for — this is the BakedDashboard counterpart.
import type { ValidateFunction } from "ajv";
import type { BakedDashboard as BakedDashboardT } from "../baked.js";

declare const validate: ValidateFunction<BakedDashboardT>;
export default validate;
