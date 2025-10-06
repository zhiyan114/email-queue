CREATE TABLE authKey (
  id serial primary key,
  code varchar(36) unique NOT NULL,
  ban text
);

CREATE TABLE requests (
  id serial primary key,
  key_id int NOT NULL,
  request json NOT NULL,
  fulfilled timestamp,
  FOREIGN KEY(key_id) REFERENCES authKey(id)
);