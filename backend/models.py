from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='player')
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)


class Tournament(db.Model):
    __tablename__ = 'tournaments'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    sport = db.Column(db.String(100), nullable=False)
    date = db.Column(db.Date, nullable=False)
    entry_fee = db.Column(db.Float, nullable=False, default=0)
    mode = db.Column(db.String(20), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    organizer_id = db.Column(db.Integer, db.ForeignKey('users.id'))


class Team(db.Model):
    __tablename__ = 'teams'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    sport = db.Column(db.String(100), nullable=False)
    skill_level = db.Column(db.String(50))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))


class Registration(db.Model):
    __tablename__ = 'registrations'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    tournament_id = db.Column(db.Integer, db.ForeignKey('tournaments.id'), nullable=False)
    team_id = db.Column(db.Integer, db.ForeignKey('teams.id'), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'tournament_id', name='uq_user_tournament'),
    )
