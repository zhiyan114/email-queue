CREATE TABLE authKeys (
  id serial primary key,
  label varchar(100),
  code varchar(36) unique NOT NULL,
  ban text
);
CREATE TABLE requests (
  id serial primary key,
  key_id int NOT NULL,
  req_id varchar(36) NOT NULL,
  mail_from text NOT NULL,
  mail_to text not NULL,
  mail_subject text not NULL,
  mail_text text,
  mail_html text,
  fulfilled timestamp,
  FOREIGN KEY(key_id) REFERENCES authKeys(id),
  check(num_nonnulls(mail_text, mail_html) = 1)
);