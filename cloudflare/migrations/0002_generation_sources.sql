ALTER TABLE accounts ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN reference_ids TEXT NOT NULL DEFAULT '[]';
