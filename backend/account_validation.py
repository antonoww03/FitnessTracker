"""Shared account creation rules; existing credential verification is separate."""
import re


def normalize_email(value):
    # Deliberately support unquoted ASCII mailbox addresses, no DNS/network lookup.
    # Case-insensitive account identity, including the local part. Do not remove
    # plus tags or dots: those rules are provider-specific.
    if not isinstance(value, str):
        raise ValueError('Enter a valid email address.')
    value = value.strip().lower()
    if len(value) > 254 or value.count('@') != 1:
        raise ValueError('Enter a valid email address.')
    local, domain = value.split('@')
    if (not 1 <= len(local) <= 64 or not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~.-]+", local)
            or local.startswith('.') or local.endswith('.') or '..' in local):
        raise ValueError('Enter a valid email address.')
    labels = domain.split('.')
    if len(labels) < 2 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
        raise ValueError('Enter a valid email address.')
    return value


def valid_new_password(value):
    return 8 <= len(value) <= 128 and re.search(r'[A-Z]', value) is not None
