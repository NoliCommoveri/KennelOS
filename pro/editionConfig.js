// pro/editionConfig.js — Pro edition config.
//
// Pro is the full, unlimited app. This is identical to the shared default:
// no-op cap hooks + full-feature flags. It's kept as its own file so the
// edition set is uniform (every edition owns one), and so a deploy can place
// the right config at shared's fixed path (shared/data/editionConfig.js) for
// each origin — Pro's shipped bytes therefore contain NO cap logic (cap spec §8).

export const edition = 'pro';

export async function enforceDogCap(/* { candidate, existing, id } */) {
  // no-op: Pro is unlimited.
}

export async function enforceLitterCap(/* { candidate } */) {
  // no-op: Pro is unlimited.
}

export const editionFlags = {
  manualDogArchive: true,
  includeArchivedToggles: true,
  archivedDogLinks: true,
};
