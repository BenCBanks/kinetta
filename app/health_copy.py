"""User-facing copy for Health permission errors."""

LEGACY_HEALTH_SHARING_ERROR = 'Review Apple Health and Garmin data sharing with Kit under Me > Connections first.'
HEALTH_SHARING_REQUIRED = 'Review the Health app and Garmin data sharing with Kit under Me > Connections first.'


def user_message(message):
    return HEALTH_SHARING_REQUIRED if message == LEGACY_HEALTH_SHARING_ERROR else message
