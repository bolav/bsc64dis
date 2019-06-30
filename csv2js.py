import csv
import json
lines = []
with open('opcodes.csv') as csv_file:
    csv_reader = csv.reader(csv_file, delimiter=',')
    line_count = 0
    for row in csv_reader:
        lines.append(row)

print(json.dumps(lines))