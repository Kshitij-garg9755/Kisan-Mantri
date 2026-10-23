"""Validation helpers shared by Farmer Marketplace API routes."""

MARKETPLACE_STATUSES = (
    'placed', 'confirmed', 'preparing', 'ready_for_pickup', 'assigned',
    'picked_up', 'in_transit', 'near_delivery', 'delivered', 'cancelled',
    'return_requested', 'returned',
)


def parse_product(data):
    required = ('name', 'category', 'product_type', 'price', 'unit', 'quantity')
    if any(not str(data.get(field) or '').strip() for field in required):
        return None, 'product_required_fields_missing'
    try:
        price = float(data['price'])
        quantity = float(data['quantity'])
        minimum = float(data.get('min_order_quantity') or 1)
    except (TypeError, ValueError):
        return None, 'invalid_product_numbers'
    if price < 0 or quantity < 0 or minimum <= 0 or minimum > quantity:
        return None, 'invalid_product_quantity'
    return {
        'name': str(data['name']).strip()[:120],
        'category': str(data['category']).strip()[:60],
        'product_type': str(data['product_type']).strip()[:40],
        'description': str(data.get('description') or '').strip()[:3000],
        'price': price,
        'unit': str(data['unit']).strip()[:30],
        'quantity': quantity,
        'min_order_quantity': minimum,
        'organic': 1 if data.get('organic') in (True, 1, '1', 'true', 'on') else 0,
        'harvest_date': str(data.get('harvest_date') or '').strip()[:30],
        'delivery_time': str(data.get('delivery_time') or '').strip()[:120],
        'village': str(data.get('village') or '').strip()[:120],
        'farm_location': str(data.get('farm_location') or '').strip()[:300],
        'quality_details': str(data.get('quality_details') or '').strip()[:1000],
    }, None
