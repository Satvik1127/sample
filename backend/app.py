from datetime import datetime

from flask import Flask, request, jsonify
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

from models import db, User, Tournament, Registration
from config import Config
from utils import haversine

app = Flask(__name__)
app.config.from_object(Config)

db.init_app(app)
jwt = JWTManager(app)
CORS(app)

with app.app_context():
    db.create_all()


def json_error(message, code=400):
    return jsonify({'error': message}), code


def user_to_public(user):
    return {
        'id': user.id,
        'name': user.name,
        'email': user.email,
        'role': user.role,
        'latitude': user.latitude,
        'longitude': user.longitude,
    }


def parse_float(value, field):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f'Invalid {field}')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}

    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    role = (data.get('role') or 'player').strip().lower()

    if not name or not email or not password:
        return json_error('name, email and password are required')

    if role not in ['player', 'organizer']:
        return json_error('role must be player or organizer')

    if User.query.filter_by(email=email).first():
        return json_error('Email already registered', 409)

    latitude = data.get('latitude')
    longitude = data.get('longitude')

    if latitude is not None:
        latitude = parse_float(latitude, 'latitude')
    if longitude is not None:
        longitude = parse_float(longitude, 'longitude')

    user = User(
        name=name,
        email=email,
        password=generate_password_hash(password),
        role=role,
        latitude=latitude,
        longitude=longitude,
    )

    db.session.add(user)
    db.session.commit()

    return jsonify({'message': 'User created'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password, password):
        return json_error('Invalid credentials', 401)

    token = create_access_token(identity=str(user.id))
    return jsonify({'access_token': token, 'user': user_to_public(user)})


@app.route('/me', methods=['GET'])
@jwt_required()
def me():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    if not user:
        return json_error('User not found', 404)
    return jsonify(user_to_public(user))


@app.route('/init-data', methods=['POST'])
def init_data():
    samples = [
        {
            'name': 'Basketball Championship',
            'sport': 'Basketball',
            'date': datetime.strptime('2026-03-20', '%Y-%m-%d').date(),
            'entry_fee': 50.0,
            'mode': 'team',
            'latitude': 40.7128,
            'longitude': -74.0060,
        },
        {
            'name': 'Soccer Open Cup',
            'sport': 'Soccer',
            'date': datetime.strptime('2026-03-25', '%Y-%m-%d').date(),
            'entry_fee': 30.0,
            'mode': 'team',
            'latitude': 40.7580,
            'longitude': -73.9855,
        },
        {
            'name': 'Mumbai Football Cup',
            'sport': 'Football',
            'date': datetime.strptime('2026-03-10', '%Y-%m-%d').date(),
            'entry_fee': 500.0,
            'mode': 'team',
            'latitude': 19.0760,
            'longitude': 72.8777,
        },
    ]

    created = 0
    for sample in samples:
        if Tournament.query.filter_by(name=sample['name'], date=sample['date']).first():
            continue
        db.session.add(Tournament(**sample))
        created += 1

    db.session.commit()
    return jsonify({'message': 'Sample data processed', 'created': created}), 201


@app.route('/tournaments', methods=['GET'])
def get_tournaments():
    lat = request.args.get('lat')
    lng = request.args.get('lng')
    radius = request.args.get('radius', 50)
    sport = (request.args.get('sport') or '').strip().lower()

    try:
        radius = float(radius)
    except (TypeError, ValueError):
        return json_error('Invalid radius')

    if radius <= 0:
        return json_error('radius must be greater than 0')

    has_location = lat is not None and lng is not None
    if has_location:
        try:
            lat = float(lat)
            lng = float(lng)
        except ValueError:
            return json_error('Invalid lat/lng')

    tournaments = Tournament.query.order_by(Tournament.date.asc()).all()
    results = []

    for tournament in tournaments:
        if sport and tournament.sport.lower() != sport:
            continue

        distance = None
        if has_location:
            distance = haversine(lat, lng, tournament.latitude, tournament.longitude)
            if distance > radius:
                continue

        results.append(
            {
                'id': tournament.id,
                'name': tournament.name,
                'sport': tournament.sport,
                'distance': round(distance, 2) if distance is not None else None,
                'date': tournament.date.isoformat(),
                'entry_fee': float(tournament.entry_fee),
                'mode': tournament.mode,
                'latitude': tournament.latitude,
                'longitude': tournament.longitude,
            }
        )

    return jsonify(results)


@app.route('/tournaments', methods=['POST'])
@jwt_required()
def create_tournament():
    user_id = int(get_jwt_identity())
    organizer = User.query.get(user_id)
    if not organizer:
        return json_error('User not found', 404)

    if organizer.role != 'organizer':
        return json_error('Only organizer can create tournaments', 403)

    data = request.get_json(silent=True) or {}

    try:
        tournament = Tournament(
            name=(data.get('name') or '').strip(),
            sport=(data.get('sport') or '').strip(),
            date=datetime.strptime(data.get('date', ''), '%Y-%m-%d').date(),
            entry_fee=float(data.get('entry_fee', 0)),
            mode=(data.get('mode') or '').strip().lower(),
            latitude=float(data.get('latitude')),
            longitude=float(data.get('longitude')),
            organizer_id=organizer.id,
        )
    except ValueError:
        return json_error('Invalid tournament payload')

    if not tournament.name or not tournament.sport:
        return json_error('name and sport are required')

    if tournament.mode not in ['individual', 'team']:
        return json_error('mode must be individual or team')

    db.session.add(tournament)
    db.session.commit()

    return jsonify({'message': 'Tournament created', 'id': tournament.id}), 201


@app.route('/tournaments/<int:tournament_id>/register', methods=['POST'])
@jwt_required()
def register_tournament(tournament_id):
    user_id = int(get_jwt_identity())

    if not User.query.get(user_id):
        return json_error('User not found', 404)

    tournament = Tournament.query.get(tournament_id)
    if not tournament:
        return json_error('Tournament not found', 404)

    existing = Registration.query.filter_by(user_id=user_id, tournament_id=tournament_id).first()
    if existing:
        return json_error('Already registered for this tournament', 409)

    data = request.get_json(silent=True) or {}
    team_id = data.get('team_id')

    registration = Registration(
        user_id=user_id,
        tournament_id=tournament_id,
        team_id=team_id,
    )

    db.session.add(registration)
    db.session.commit()

    return jsonify({'message': 'Registration successful'}), 201


@app.route('/my-registrations', methods=['GET'])
@jwt_required()
def my_registrations():
    user_id = int(get_jwt_identity())

    entries = (
        db.session.query(Registration, Tournament)
        .join(Tournament, Tournament.id == Registration.tournament_id)
        .filter(Registration.user_id == user_id)
        .order_by(Tournament.date.asc())
        .all()
    )

    results = []
    for registration, tournament in entries:
        results.append(
            {
                'registration_id': registration.id,
                'tournament_id': tournament.id,
                'name': tournament.name,
                'sport': tournament.sport,
                'date': tournament.date.isoformat(),
                'entry_fee': float(tournament.entry_fee),
                'mode': tournament.mode,
            }
        )

    return jsonify(results)


if __name__ == '__main__':
    app.run(debug=True)
