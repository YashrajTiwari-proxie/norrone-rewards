import type { SubmitFunction } from '@sveltejs/kit';

/**
 * Wraps a form's use:enhance so the caller gets a `submitting` flag flipped
 * around the request, and an optional callback (e.g. closing a drawer) once
 * the update has applied.
 */
export function withLoading(setSubmitting: (v: boolean) => void, onDone?: () => void): SubmitFunction {
	return () => {
		setSubmitting(true);
		return async ({ update }) => {
			await update();
			setSubmitting(false);
			onDone?.();
		};
	};
}
