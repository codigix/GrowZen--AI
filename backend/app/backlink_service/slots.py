"""Time slots: businesses (targets) are split into groups of BACKLINK_DB_SLOT_BUSINESSES (5), in the order they were
added. Group 1 is searched for BACKLINK_DB_SLOT_HOURS (3 h), then group 2 for the next 3 h, and so on, wrapping around."""
import math


def plain_mode(n_targets: int, slot_size: int, slot_hours: float) -> bool:
    """One group only (or slots switched off): no rotation, every target is searched all the time."""
    return slot_hours <= 0 or n_targets <= max(1, slot_size)


def group_for_slot(targets: list, slot_size: int, slot_index: int) -> tuple[list, int]:
    """(the targets of this slot, number of groups). Targets are ordered by id, so groups stay stable."""
    size = max(1, slot_size)
    ordered = sorted(targets, key=lambda t: t.id)
    groups = [ordered[i:i + size] for i in range(0, len(ordered), size)] or [[]]
    return groups[slot_index % len(groups)], math.ceil(len(ordered) / size) if ordered else 0


def fresh_targets(targets: list, group: list, window_seconds: float, now=None) -> list:
    """Targets created within the last window that are not in the current group: a business that was just onboarded
    does not wait for its slot."""
    from datetime import datetime, timezone

    now = now or datetime.now(timezone.utc)
    in_group = {t.id for t in group}
    fresh = []
    for t in targets:
        created = t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=timezone.utc)
        if t.id not in in_group and (now - created).total_seconds() < window_seconds:
            fresh.append(t)
    return fresh
