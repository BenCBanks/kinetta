"""Legacy-client write adapters; new challenge routes are deliberately a separate cutover."""


def seed_legacy(c, group_id):
    """A new old-client group still has exactly one legacy challenge; retries preserve choices."""
    c.execute('''INSERT INTO group_challenges(group_id,creator_id,legacy_group_id,title,metric,target,unit,sports,
        start_date,end_date,time_zone,note,training_for,ended_at,created)
        SELECT id,organizer_id,id,title,goal_type,goal_target,goal_unit,goal_sports,
        goal_start_date,event_date,time_zone,note,training_for,closed_at,created FROM event_groups WHERE id=%s
        ON CONFLICT(legacy_group_id) DO NOTHING''', (group_id,))
    c.execute('''INSERT INTO group_challenge_members(challenge_id,group_id,user_id,share_total,joined_at)
        SELECT q.id,m.group_id,m.user_id,m.sharing_level='total_shared',m.joined_at
        FROM group_challenges q JOIN group_members m ON m.group_id=q.legacy_group_id WHERE m.group_id=%s
        ON CONFLICT(challenge_id,user_id) DO NOTHING''', (group_id,))


def join(c, group_id, user_id):
    """An actual join refreshes the time boundary, never a recorded challenge opt-out."""
    # Explicit join OFF applies to every new choice; defaults never override it.
    # Migration 122 reconciled old goals; joining a people-only group must not create one.
    c.execute('''INSERT INTO group_challenge_members(challenge_id,group_id,user_id,share_total,joined_at)
        SELECT q.id,m.group_id,m.user_id,m.sharing_level='total_shared',m.joined_at
        FROM group_challenges q JOIN group_members m ON m.group_id=q.group_id
        WHERE m.group_id=%s AND m.user_id=%s AND m.status='active'
        ON CONFLICT(challenge_id,user_id) DO UPDATE
        SET share_total=CASE WHEN EXISTS(SELECT 1 FROM group_challenges q
                WHERE q.id=EXCLUDED.challenge_id AND q.legacy_group_id=EXCLUDED.group_id)
            THEN group_challenge_members.share_total AND EXCLUDED.share_total
            ELSE group_challenge_members.share_total END,
            joined_at=EXCLUDED.joined_at''', (group_id, user_id))


def legacy_sharing(c, group_id, user_id, share_total):
    # The old single-goal switch controls only that seeded challenge, never later challenges or master consent.
    c.execute('''UPDATE group_challenge_members m SET share_total=%s FROM group_challenges q
        WHERE q.id=m.challenge_id AND q.legacy_group_id=%s AND m.user_id=%s''', (share_total, group_id, user_id))


def legacy_date(c, group_id, end_date):
    c.execute('UPDATE group_challenges SET end_date=%s WHERE legacy_group_id=%s', (end_date, group_id))


def close(c, group_id):
    c.execute('UPDATE group_challenges SET ended_at=coalesce(ended_at,now()) WHERE group_id=%s', (group_id,))
