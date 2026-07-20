"""Temporal client connection, shared by the API and the worker.

The address/namespace/API-key settings are the entire dev/prod switch: the
default settings target the docker-compose server, and pointing them at a
Temporal Cloud namespace (which requires TLS + an API key) is the only change
needed in production.
"""

from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter

from app.core.config import Settings


async def connect_temporal(settings: Settings) -> Client:
    if settings.temporal_api_key:
        return await Client.connect(
            settings.temporal_address,
            namespace=settings.temporal_namespace,
            api_key=settings.temporal_api_key,
            tls=True,
            data_converter=pydantic_data_converter,
        )
    return await Client.connect(
        settings.temporal_address,
        namespace=settings.temporal_namespace,
        data_converter=pydantic_data_converter,
    )
