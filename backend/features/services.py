"""Service helpers for the integrated feature modules.

Keeps business rules (status labels, AI hook, satellite/NDVI hook, weather)
out of the route layer so they are easy to replace later.
"""
from __future__ import annotations

import os

# Honest, explicit data-source labels used throughout the UI.
STATUS_DEMO = 'demo'
STATUS_LIVE = 'live'
STATUS_CACHED = 'cached'
STATUS_UNAVAILABLE = 'unavailable'

AI_MODEL_ENV = 'CROP_DIAGNOSIS_API_URL'


def ai_model_configured() -> bool:
    """True only when a real disease-diagnosis model endpoint is configured."""
    return bool(os.environ.get(AI_MODEL_ENV))


def diagnosis_stub(crop: str) -> dict:
    """Return an honest, clearly-labelled demonstration response.

    This is NOT a real diagnosis. It never claims a confidence score and it
    always carries ``status='demo'`` so the UI can label it explicitly and for
    the disclaimer to be shown.
    """
    return {
        'status': STATUS_DEMO,
        'result_label': 'AI model not connected',
        'confidence': None,
        'crop': crop,
        'message': (
            'No trained crop-disease model is connected to this server yet, so a real '
            'diagnosis cannot be produced. This screen only demonstrates the upload and '
            'history workflow. Please get the crop inspected by your local agriculture '
            'extension officer (KVK / Agriculture Department).'
        ),
        'symptoms': '',
        'prevention': '',
        'treatment': '',
    }


SATELLITE_API_ENV = 'SATELLITE_NDVI_API_URL'


def satellite_layers() -> dict:
    """Describe which satellite layers are actually available.

    The base map and Esri World Imagery tiles are always available in the
    browser. A real NDVI / crop-health layer requires a configured
    ``SATELLITE_NDVI_API_URL``; until then it is reported as unavailable.
    """
    ndvi_configured = bool(os.environ.get(SATELLITE_API_ENV))
    return {
        'base_map': {'status': STATUS_LIVE, 'provider': 'OpenStreetMap', 'note': 'Street base map.'},
        'satellite_imagery': {
            'status': STATUS_LIVE,
            'provider': 'Esri World Imagery',
            'note': 'Satellite / aerial imagery tiles. Not an NDVI analysis.',
        },
        'ndvi': {
            'status': STATUS_LIVE if ndvi_configured else STATUS_UNAVAILABLE,
            'provider': 'Custom NDVI API' if ndvi_configured else None,
            'note': (
                'NDVI endpoint configured.'
                if ndvi_configured
                else 'No NDVI / crop-health API is connected. Crop health values shown are illustrative only.'
            ),
        },
        'weather': {'status': STATUS_LIVE, 'provider': 'Open-Meteo', 'note': 'Live weather via the Smart Farm backend.'},
    }


def classify_weather_status(ok: bool) -> str:
    return STATUS_LIVE if ok else STATUS_UNAVAILABLE
