import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { endApplicationSession } from "../session";

/**
 * v4 Requirement #13: the Logout button, for every department.
 *
 * The teardown itself lives in `src/session.ts` because a session also ends
 * without anyone pressing this button -- a 401 from an expired or revoked token
 * ends one too, and both paths have to leave identical state behind. All this
 * hook adds is the navigation a button press should perform.
 *
 * It takes no department: Logout ends the authenticated APPLICATION session, so
 * there is nothing department-specific left to decide. Ending only the
 * department on screen would leave a stale token in another slot, and pressing
 * that department on the Department Selector would then walk straight into its
 * workspace without code entry -- see the comment on endApplicationSession().
 */
export function useLogout() {
  const navigate = useNavigate();

  return useCallback(() => {
    endApplicationSession();

    // Replace rather than push, so the browser Back button cannot return to the
    // protected page just left. The guards would bounce it anyway now that every
    // auth slot is empty; this stops the flash of trying.
    navigate("/", { replace: true });
  }, [navigate]);
}
