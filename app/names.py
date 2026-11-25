"""Name handling and privacy-aware display projections for account names."""
import re
import unicodedata


def normalize_part(value):
    value = unicodedata.normalize('NFC', str(value or ''))
    return ' '.join(value.split())


def split_legacy_name(value):
    """Old clients send one display name; preserve its first word and remaining surname."""
    value = normalize_part(value)
    if not value:
        return '', ''
    first, sep, rest = value.partition(' ')
    return first, rest if sep else ''


def _letter_joiner(value, index):
    if value[index] not in '\u200c\u200d':
        return False
    # Indic consonants may carry a virama before the joiner.
    left, right = index - 1, index + 1
    while left >= 0 and unicodedata.category(value[left]).startswith('M'):
        left -= 1
    return (left >= 0 and right < len(value) and
            unicodedata.category(value[left]).startswith('L') and
            unicodedata.category(value[right]).startswith('L'))


def has_control(value):
    value = unicodedata.normalize('NFC', str(value or ''))
    return any(unicodedata.category(char).startswith('C') and not _letter_joiner(value, index)
               for index, char in enumerate(value))


def valid_part(value):
    if not 1 <= len(value) <= 40:
        return False
    has_letter = False
    for index, char in enumerate(value):
        category = unicodedata.category(char)
        if category.startswith('L'):
            has_letter = True
        elif category.startswith('M') or char in " -'.’":
            continue
        elif _letter_joiner(value, index):
            continue
        else:
            return False
    return has_letter


def display_name_sql(alias='u', viewer='%(viewer)s', admin=None):
    """SQL expression for a name safe to show to this viewer.

    The response carries only the `name` value. It never serializes last_name. Full names
    are available to the person, admins, and accepted friends; every other viewer gets first.
    """
    if admin is None:
        admin = f"coalesce((SELECT is_admin FROM users WHERE id={viewer}), false)"
    return f"""CASE WHEN ({admin} OR {alias}.id={viewer} OR EXISTS(
       SELECT 1 FROM friendships name_friend
       WHERE name_friend.status='accepted'
         AND {viewer} IN (name_friend.requester,name_friend.addressee)
         AND {alias}.id IN (name_friend.requester,name_friend.addressee)))
       THEN {alias}.name ELSE {alias}.first_name END"""
