/**
 * Matching between a client's event service requirement and a professional's
 * own service. The two are free-text ("Wedding videoman" vs "Professional
 * Weedding Videoman"), so the comparison is done on a normalised form:
 * lowercase, letters and digits only.
 *
 * The frontend applies the same rule (src/utils/service-match.util.ts).
 */

/** Shortest name that may be matched by containment. */
const MIN_CONTAINED_LENGTH = 4;
/** Edit distance allowed between two words of the same name. */
const MAX_EDIT_DISTANCE = 1;
/** Word length from which a larger edit distance is allowed. */
const LONG_WORD_LENGTH = 8;
const MAX_EDIT_DISTANCE_LONG = 2;

export const normalizeServiceName = (value?: string | null): string =>
	(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const words = (value?: string | null): string[] =>
	(value ?? "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

const editDistance = (left: string, right: string): number => {
	if (left === right) {
		return 0;
	}

	if (!left.length) {
		return right.length;
	}

	if (!right.length) {
		return left.length;
	}

	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

	for (let i = 1; i <= left.length; i++) {
		const current = [i];

		for (let j = 1; j <= right.length; j++) {
			const cost = left[i - 1] === right[j - 1] ? 0 : 1;

			current[j] = Math.min(
				current[j - 1] + 1,
				previous[j] + 1,
				previous[j - 1] + cost,
			);
		}

		previous = current;
	}

	return previous[right.length];
};

const wordsMatch = (left: string, right: string): boolean => {
	if (left === right) {
		return true;
	}

	if (
		left.length < MIN_CONTAINED_LENGTH ||
		right.length < MIN_CONTAINED_LENGTH
	) {
		return false;
	}

	const [shorter, longer] =
		left.length <= right.length ? [left, right] : [right, left];

	if (longer.includes(shorter)) {
		return true;
	}

	const maxDistance =
		longer.length >= LONG_WORD_LENGTH
			? MAX_EDIT_DISTANCE_LONG
			: MAX_EDIT_DISTANCE;

	return editDistance(shorter, longer) <= maxDistance;
};

/**
 * True when a requirement and a professional service describe the same
 * offering:
 * - the normalised names are equal ("Photography" / "photography"), or
 * - one normalised name is contained in the other ("video man" inside
 *   "professional weedding videoman"), or
 * - every word of the requirement is covered by a word of the service
 *   ("wedding videoman" against "professional weedding videoman", where
 *   "wedding" and "weedding" differ by a typo).
 */
export const serviceNamesMatch = (
	requirementName?: string | null,
	serviceName?: string | null,
): boolean => {
	const requirement = normalizeServiceName(requirementName);
	const service = normalizeServiceName(serviceName);

	if (!requirement || !service) {
		return false;
	}

	if (requirement === service) {
		return true;
	}

	const [shorter, longer] =
		requirement.length <= service.length
			? [requirement, service]
			: [service, requirement];

	if (shorter.length >= MIN_CONTAINED_LENGTH && longer.includes(shorter)) {
		return true;
	}

	const requirementWords = words(requirementName);
	const serviceWords = words(serviceName);

	if (requirementWords.length === 0 || serviceWords.length === 0) {
		return false;
	}

	return requirementWords.every((requirementWord) =>
		serviceWords.some((serviceWord) =>
			wordsMatch(requirementWord, serviceWord),
		),
	);
};
