"""One visibility rule for deliberately shared recipes and their notifications."""
SHARED = """EXISTS (SELECT 1 FROM dish_shares s WHERE s.dish_id = dishes.id AND s.user_id = %(u)s)
            AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
              AND ((f.requester = dishes.user_id AND f.addressee = %(u)s) OR (f.addressee = dishes.user_id AND f.requester = %(u)s)))
            AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=dishes.user_id AND b.blocked=%(u)s) OR (b.user_id=%(u)s AND b.blocked=dishes.user_id))"""
# Notification queries use their recipient, not a caller-supplied owner.
NOTICE_VISIBLE = "NOT n.cancelled AND (n.kind <> 'dish_shared' OR EXISTS (SELECT 1 FROM dishes WHERE dishes.id=n.dish_id AND dishes.user_id=n.actor_id AND ("+SHARED.replace('%(u)s','n.user_id')+")))"
