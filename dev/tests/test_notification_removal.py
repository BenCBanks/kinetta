"""The removed meal notification has no route, startup worker or push sender."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_meal_reminder_notification_path_is_absent():
    main = (ROOT / 'app/main.py').read_text()
    notify = (ROOT / 'app/notify.py').read_text()
    personal = (ROOT / 'app/personal_notifications.py').read_text()
    assert 'meal_reminders' not in main and '/api/food/reminders' not in main
    assert 'private_meal_push' not in notify and "'meal'," not in notify
    assert 'meal_reminders' not in personal and 'def device_ready(c, uid):' in personal


if __name__ == '__main__':
    test_meal_reminder_notification_path_is_absent()
    print('Meal reminder route/startup/push path absent; other personal alert device checks remain PASS')
