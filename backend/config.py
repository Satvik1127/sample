class Config:
    SECRET_KEY = "supersecret"
    SQLALCHEMY_DATABASE_URI = "mysql+mysqlconnector://root:@localhost/sports_platform"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = "jwt-secret"
