create table tasks (id integer primary key, text text not null, done integer not null default 0);
insert into tasks (text) values ('first'), ('second');
