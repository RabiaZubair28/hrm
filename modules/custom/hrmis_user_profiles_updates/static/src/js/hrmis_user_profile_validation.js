/** @odoo-module **/

/**
 * Backward-compatible entrypoint.
 *
 * Some deployments/reference code expects validations to live in:
 * `hrmis_user_profile_validation.js`.
 *
 * The actual implementation currently lives in:
 * - `hrmis_profile_validation.js`
 * - `hrmis_extra_validations.js`
 *
 * We import both so this file "works" and keeps behavior consistent.
 */

import "./hrmis_profile_validation";
import "./hrmis_extra_validations";

