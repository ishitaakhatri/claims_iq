"""
Write-Behind Rules Cache
========================
In-memory cache for business rules. Cache is updated instantly on mutations,
DB persistence happens asynchronously in the background.

On server restart, cache reloads from DB (source of truth).
"""

import threading
import asyncio
import json
import uuid
from .database import get_all_rules, upsert_rule as db_upsert_rule, delete_rule as db_delete_rule


class RulesCache:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._rules = None
        return cls._instance

    # ─── Read Operations (from cache) ─────────────────────────────────────

    def load(self):
        """Fetch all rules from DB and populate the cache. Called once on first use."""
        with self._lock:
            print("[RulesCache] Cache miss — fetching from DB...")
            self._rules = get_all_rules()
            print(f"[RulesCache] Loaded {len(self._rules)} rules into cache")

    def get_rules(self) -> list:
        """Return all cached rules. Loads from DB on first call."""
        if self._rules is None:
            self.load()
        else:
            print(f"[RulesCache] Cache hit — {len(self._rules)} rules")
        return list(self._rules)  # Return a copy to prevent external mutation

    def get_active(self) -> list:
        """Return only active (is_active=True) rules from cache."""
        rules = self.get_rules()
        active = [r for r in rules if r.get("is_active", True)]
        print(f"[RulesCache] Returning {len(active)} active rules (of {len(rules)} total)")
        return active

    # ─── Write Operations (cache first, DB in background) ─────────────────

    def add(self, rule: dict):
        """Add a new rule to the cache immediately."""
        if self._rules is None:
            self.load()
        with self._lock:
            self._rules.append(rule)
            # Re-sort by priority for consistency
            self._rules.sort(key=lambda r: r.get("priority", 99))
        print(f"[RulesCache] Added rule {rule.get('id')} to cache ({len(self._rules)} total)")

    def update(self, rule: dict):
        """Replace an existing rule in the cache by ID."""
        if self._rules is None:
            self.load()
        rule_id = rule.get("id")
        with self._lock:
            self._rules = [rule if r.get("id") == rule_id else r for r in self._rules]
            self._rules.sort(key=lambda r: r.get("priority", 99))
        print(f"[RulesCache] Updated rule {rule_id} in cache")

    def remove(self, rule_id: str):
        """Remove a rule from the cache by ID."""
        if self._rules is None:
            self.load()
        with self._lock:
            self._rules = [r for r in self._rules if r.get("id") != rule_id]
        print(f"[RulesCache] Removed rule {rule_id} from cache ({len(self._rules)} remaining)")

    # ─── Background DB Persistence ────────────────────────────────────────

    async def bg_upsert(self, rule_data: dict):
        """Fire-and-forget: persist a rule to DB in the background."""
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, db_upsert_rule, rule_data)
            print(f"[RulesCache] Background DB upsert complete for {result.get('id')}")
        except Exception as e:
            print(f"[RulesCache] ⚠️ Background DB upsert FAILED: {e}")

    async def bg_delete(self, rule_id: str):
        """Fire-and-forget: delete a rule from DB in the background."""
        try:
            loop = asyncio.get_event_loop()
            deleted = await loop.run_in_executor(None, db_delete_rule, rule_id)
            print(f"[RulesCache] Background DB delete complete for {rule_id}: {deleted}")
        except Exception as e:
            print(f"[RulesCache] ⚠️ Background DB delete FAILED: {e}")

    def generate_rule_id(self) -> str:
        """Generate the next BR### ID based on current cache contents."""
        if self._rules is None:
            self.load()
        import re
        max_num = 0
        for rule in self._rules:
            match = re.match(r'^BR(\d+)$', rule.get("id", ""))
            if match:
                max_num = max(max_num, int(match.group(1)))
        return f"BR{max_num + 1:03d}"


# ─── Global singleton ────────────────────────────────────────────────────────

rules_cache = RulesCache()
