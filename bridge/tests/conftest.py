"""Pytest configuration for harbor_bridge tests."""

import pytest


@pytest.fixture
def sample_hello_message() -> dict[str, str]:
    """Return a sample hello message."""
    return {"type": "hello", "request_id": "test-123"}


@pytest.fixture
def sample_pong_message() -> dict[str, str]:
    """Return a sample pong message."""
    return {"type": "pong", "request_id": "test-123", "bridge_version": "0.0.1"}
