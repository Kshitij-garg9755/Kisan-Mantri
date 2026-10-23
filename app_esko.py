from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
import os
import requests
import random
import time

app = FastAPI()

otp_store = {}

@app.get("/")
async def root():
    return FileResponse('login.html')

@app.get("/{path:path}")
async def static_proxy(path: str):
    if os.path.isdir(path):
        index_path = os.path.join(path, 'index.html')
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return HTMLResponse('<h1>404 Not Found</h1>', status_code=404)
    if os.path.exists(path):
        return FileResponse(path)
    return HTMLResponse('<h1>404 Not Found</h1>', status_code=404)

@app.post("/api/chat")
async def api_chat(request: Request):
    data = await request.json()
    message = (data.get('message') or '').strip()
    if not message:
        raise HTTPException(status_code=400, detail="empty_message")
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        return JSONResponse({'error': 'no_api_key', 'answer': 'Backend not configured with OpenAI API key.'}, status_code=500)
    url = 'https://api.openai.com/v1/chat/completions'
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    payload = {
        'model': 'gpt-4o-mini',
        'messages': [
            { 'role': 'system', 'content': 'You are a helpful assistant for a farm products website. Keep answers concise and friendly.' },
            { 'role': 'user', 'content': message }
        ],
        'temperature': 0.3
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    if resp.status_code >= 400:
        return JSONResponse({'error': 'upstream_error', 'status': resp.status_code, 'answer': 'Service temporarily unavailable.'}, status_code=502)
    data = resp.json()
    answer = (data.get('choices') or [{}])[0].get('message', {}).get('content', '').strip()
    if not answer:
        answer = 'Sorry, I could not generate a reply right now.'
    return JSONResponse({'answer': answer})

@app.get("/api/weather")
async def api_weather(city: str = ""):
    city = city.strip()
    if not city:
        raise HTTPException(status_code=400, detail="missing_city")
    api_key = os.environ.get('OPENWEATHER_API_KEY')
    if not api_key:
        return JSONResponse({'error': 'no_api_key', 'message': 'Missing OPENWEATHER_API_KEY'}, status_code=500)
    params = {
        'q': city,
        'appid': api_key,
        'units': 'metric'
    }
    r = requests.get('https://api.openweathermap.org/data/2.5/weather', params=params, timeout=20)
    if r.status_code >= 400:
        return JSONResponse({'error': 'upstream_error', 'status': r.status_code}, status_code=502)
    data = r.json()
    out = {
        'city': data.get('name'),
        'temp_c': (data.get('main') or {}).get('temp'),
        'feels_like_c': (data.get('main') or {}).get('feels_like'),
        'humidity': (data.get('main') or {}).get('humidity'),
        'wind_ms': (data.get('wind') or {}).get('speed'),
        'weather': ((data.get('weather') or [{}])[0]).get('description')
    }
    return JSONResponse(out)

@app.get("/api/mandi")
async def api_mandi(state: str = "", district: str = "", market: str = "", commodity: str = "", limit: int = 25):
    api_key = os.environ.get('AGMARKNET_API_KEY')
    if not api_key:
        return JSONResponse({'error': 'no_api_key', 'message': 'Missing AGMARKNET_API_KEY'}, status_code=500)
    resource_id = '9ef84268-d588-465a-a308-a864a43d0070'
    params = {
        'api-key': api_key,
        'format': 'json',
        'resource_id': resource_id,
        'limit': limit,
        'sort': 'arrival_date desc'
    }
    filters = {}
    if state: filters['state'] = state
    if district: filters['district'] = district
    if market: filters['market'] = market
    if commodity: filters['commodity'] = commodity
    if filters:
        params['filters'] = filters
    r = requests.get(f'https://api.data.gov.in/resource/{resource_id}', params=params, timeout=25)
    if r.status_code >= 400:
        return JSONResponse({'error': 'upstream_error', 'status': r.status_code}, status_code=502)
    data = r.json()
    records = data.get('records') or []
    out = []
    for rec in records:
        out.append({
            'state': rec.get('state'),
            'district': rec.get('district'),
            'market': rec.get('market'),
            'commodity': rec.get('commodity'),
            'variety': rec.get('variety'),
            'arrival_date': rec.get('arrival_date'),
            'min_price': rec.get('min_price'),
            'max_price': rec.get('max_price'),
            'modal_price': rec.get('modal_price'),
            'unit_of_price': rec.get('price_unit') or 'Rs/Quintal'
        })
    return JSONResponse({'count': len(out), 'results': out})

@app.post("/send_otp")
async def send_otp(request: Request):
    data = await request.json()
    phone = data.get('phone')
    if not phone or len(phone) != 10:
        return JSONResponse({'success': False, 'message': 'Invalid phone number'}, status_code=400)
    otp = str(random.randint(100000, 999999))
    otp_store[phone] = {'otp': otp, 'timestamp': time.time()}
    return JSONResponse({'success': True, 'message': f'Your OTP is: {otp}'})

@app.post("/verify_otp")
async def verify_otp(request: Request):
    data = await request.json()
    phone = data.get('phone')
    otp = data.get('otp')
    entry = otp_store.get(phone)
    if entry and entry['otp'] == otp and time.time() - entry['timestamp'] < 300:
        return JSONResponse({'success': True, 'message': 'OTP verified'})
    return JSONResponse({'success': False, 'message': 'Invalid OTP'}, status_code=400)

@app.get("/api/products")
async def api_products():
    products = [
        { "name": "Wheat", "category": "Grain", "price": 1200, "units": 820, "stock": "In Stock", "currency": "₹" },
        { "name": "Rice", "category": "Grain", "price": 860, "units": 640, "stock": "In Stock", "currency": "₹" },
        { "name": "Tomato", "category": "Vegetable", "price": 40, "units": 980, "stock": "In Stock", "currency": "₹/kg" },
        { "name": "Green Peas", "category": "Vegetable", "price": 95, "units": 420, "stock": "In Stock", "currency": "₹/kg" },
        { "name": "Pulses", "category": "Grain", "price": 860, "units": 530, "stock": "Low", "currency": "₹" },
        { "name": "Cabbage", "category": "Vegetable", "price": 35, "units": 610, "stock": "In Stock", "currency": "₹/kg" },
        { "name": "Eggplant", "category": "Vegetable", "price": 70, "units": 380, "stock": "Low", "currency": "₹/kg" }
    ]
    return JSONResponse(products)