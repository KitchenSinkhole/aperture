-- Drops the account sound preferences. The blob is pure UI preference; a
-- re-apply lands every account back on DEFAULT_SOUND_PREFS (sounds off).
ALTER TABLE "ap_user" DROP COLUMN "sound_prefs";
