from flask import Blueprint, jsonify

marketplace_blueprint = Blueprint('marketplace_module', __name__, url_prefix='/api/marketplace')

@marketplace_blueprint.get('/health')
def marketplace_health():
    return jsonify({'section': 'farmer_marketplace', 'status': 'ready'})
