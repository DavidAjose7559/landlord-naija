-- 0006_classic_tokens.sql
--
-- Same idempotency contract as 0001-0005. Section E adds a second,
-- classic-flavoured token set (top hat, race car, dog, boot, ship,
-- thimble, wheelbarrow, iron — original artwork, see TokenIcon.tsx) on top
-- of the existing naija set. players.token's check constraint only
-- allowed the original 8 naija values; widen it to all 16.

alter table players drop constraint if exists players_token_check;
alter table players add constraint players_token_check
  check (token in (
    'danfo', 'keke', 'jollof', 'gele', 'okada', 'agbada', 'suya', 'bottle',
    'tophat', 'racecar', 'dog', 'boot', 'ship', 'thimble', 'wheelbarrow', 'iron'
  ));
