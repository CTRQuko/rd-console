"""Rate limiting on /api/auth/login and /api/join/:token.

Both endpoints are public surfaces that attract enumeration attempts.
The limiter is deliberately lenient (10/min for login, 30/min for
join) to avoid hassling legitimate users — the goal is raising the
cost of scripted abuse, not catching typos.

We exercise the limiter directly in unit mode and end-to-end through
the routers.
"""

from __future__ import annotations

from app.services import rate_limit


def test_check_allows_under_limit():
    rate_limit.reset_for_tests()
    # 9 calls at window 0 should all pass under limit=10.
    for i in range(9):
        rate_limit.check(bucket="b", key="k", limit=10, window_seconds=60, now=i * 0.1)


def test_check_rejects_over_limit():
    rate_limit.reset_for_tests()
    for i in range(10):
        rate_limit.check(bucket="b", key="k", limit=10, window_seconds=60, now=i * 0.1)
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        rate_limit.check(bucket="b", key="k", limit=10, window_seconds=60, now=1.5)
    assert exc.value.status_code == 429
    # Retry-After is set and is a non-zero integer string.
    assert int(exc.value.headers["Retry-After"]) >= 1


def test_check_window_rolls_over():
    rate_limit.reset_for_tests()
    # Fill the window, then wait past it and try again.
    for i in range(10):
        rate_limit.check(bucket="b", key="k", limit=10, window_seconds=60, now=i * 0.1)
    # After 60s the window resets, next call is fine.
    rate_limit.check(bucket="b", key="k", limit=10, window_seconds=60, now=61.0)


def test_check_separates_by_bucket_and_key():
    rate_limit.reset_for_tests()
    # Different buckets don't share budget.
    for i in range(10):
        rate_limit.check(bucket="a", key="k", limit=10, window_seconds=60, now=i * 0.1)
    rate_limit.check(bucket="b", key="k", limit=10, window_seconds=60, now=1.0)
    # Different keys within a bucket don't either.
    rate_limit.check(bucket="a", key="other", limit=10, window_seconds=60, now=1.0)


def test_login_returns_429_after_10_attempts(client):
    for _ in range(10):
        r = client.post(
            "/api/auth/login",
            json={"username": "doesnotexist", "password": "x"},
        )
        # Each one is a plain 401 — account doesn't exist. We're after the
        # limiter trip on the 11th.
        assert r.status_code == 401
    r = client.post(
        "/api/auth/login",
        json={"username": "doesnotexist", "password": "x"},
    )
    assert r.status_code == 429
    assert r.headers.get("retry-after") is not None


def test_join_returns_429_after_30_attempts(client):
    # 30 hits with obviously-invalid tokens (→ 404) then the 31st trips
    # the limiter regardless of the per-token validity.
    for _ in range(30):
        r = client.get("/api/join/nope-nope-nope")
        assert r.status_code == 404
    r = client.get("/api/join/nope-nope-nope")
    assert r.status_code == 429


def test_valid_login_still_works_under_limit(client, admin_user):
    """Sanity: the limiter does not trip legitimate traffic. Admin login
    after a handful of bad attempts should still succeed."""
    for _ in range(3):
        client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong"},
        )
    r = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "admin-pass-1234"},
    )
    assert r.status_code == 200
    assert r.json()["access_token"]
