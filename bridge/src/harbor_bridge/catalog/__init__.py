"""
Catalog providers for fetching MCP server listings from various sources.

This module provides a modular system for scraping/fetching MCP server
catalogs from different sources (registries, awesome lists, etc.)

Features:
- SQLite database for persistent caching
- Change tracking (additions, updates, removals)
- Priority scoring (remote servers first, featured, popular)
- Fast startup from cache, background refresh
"""

from .base import CatalogProvider, CatalogServer, ProviderResult
from .database import CatalogDatabase, get_catalog_db, ServerChange
from .manager import CatalogManager, get_catalog_manager
from .official_registry import OfficialRegistryProvider
from .github_awesome import GitHubAwesomeProvider

__all__ = [
    # Base classes
    "CatalogProvider",
    "CatalogServer", 
    "ProviderResult",
    # Database
    "CatalogDatabase",
    "get_catalog_db",
    "ServerChange",
    # Manager
    "CatalogManager",
    "get_catalog_manager",
    # Providers
    "OfficialRegistryProvider",
    "GitHubAwesomeProvider",
]

