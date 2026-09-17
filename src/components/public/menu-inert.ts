/**
 * Attribute marking page regions that become `inert` while the mobile menu is open.
 * Lives outside the client component so server components receive the plain string.
 */
export const MENU_INERT_TARGET = "data-menu-inert-target";

export const menuInertTargetProps = { [MENU_INERT_TARGET]: "" } as const;
