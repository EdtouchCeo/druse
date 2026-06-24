const {
  useState,
  useRef,
  useEffect
} = React;

// Lucide 아이콘들을 SVG로 직접 구현
const Search = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "11",
  cy: "11",
  r: "8"
}), /*#__PURE__*/React.createElement("path", {
  d: "M21 21l-4.35-4.35"
}));
const User = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("path", {
  d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "7",
  r: "4"
}));
const BookOpen = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("path", {
  d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"
}), /*#__PURE__*/React.createElement("path", {
  d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"
}));
const Award = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "8",
  r: "7"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "8.21,13.89 7,23 12,20 17,23 15.79,13.88"
}));
const Upload = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("path", {
  d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "7,10 12,5 17,10"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "5",
  x2: "12",
  y2: "15"
}));
const RotateCcw = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("polyline", {
  points: "1,4 1,10 7,10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10"
}));
const Eye = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("path", {
  d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "3"
}));
const HelpCircle = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 17h.01"
}));
const FileText = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("path", {
  d: "M14,2 L14,8 L20,8 M14,2 L20,8 L20,20 C20,21.1045695 19.1045695,22 18,22 L6,22 C4.8954305,22 4,21.1045695 4,20 L4,4 C4,2.8954305 4.8954305,2 6,2 L14,2 Z"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "16,13 8,13"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "16,17 8,17"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "10,9 9,9 8,9"
}));
const Type = ({
  className
}) => /*#__PURE__*/React.createElement("svg", {
  className: className,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
}, /*#__PURE__*/React.createElement("polyline", {
  points: "4,7 4,4 20,4 20,7"
}), /*#__PURE__*/React.createElement("line", {
  x1: "9",
  y1: "20",
  x2: "15",
  y2: "20"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "4",
  x2: "12",
  y2: "20"
}));
const StudentScoreApp = () => {
  const [studentData, setStudentData] = useState([]);
  const [searchName, setSearchName] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileUploaded, setFileUploaded] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [inputMethod, setInputMethod] = useState('file');
  const [textInput, setTextInput] = useState('');
  const fileInputRef = useRef(null);

  // 성명 컬럼 찾기
  const findNameColumn = headers => {
    const nameKeywords = ['성명', '이름', '학생명', '학생이름', 'name', 'student', '학번', '번호'];
    return headers.findIndex(header => nameKeywords.some(keyword => header && header.toString().toLowerCase().includes(keyword.toLowerCase())));
  };

  // 수행평가 컬럼들 찾기 (더 유연한 인식)
  const findScoreColumns = headers => {
    const scoreColumns = [];
    const nameColumnIndex = findNameColumn(headers);
    headers.forEach((header, index) => {
      // 성명 컬럼이 아닌 모든 컬럼을 점수 컬럼으로 간주
      if (index !== nameColumnIndex && header) {
        scoreColumns.push({
          index: index,
          name: header.toString()
        });
      }
    });
    return scoreColumns;
  };

  // 데이터 정제 및 학생 객체 생성
  const processStudentData = rawData => {
    if (!rawData || rawData.length < 2) {
      throw new Error('데이터가 충분하지 않습니다. 최소 헤더행과 1개 이상의 데이터행이 필요합니다.');
    }
    const headers = rawData[0];
    const nameColumnIndex = findNameColumn(headers);
    const scoreColumns = findScoreColumns(headers);
    if (nameColumnIndex === -1) {
      throw new Error('학생 이름 컬럼을 찾을 수 없습니다.\n(성명, 이름, 학생명 등의 헤더가 필요합니다)');
    }
    if (scoreColumns.length === 0) {
      throw new Error('점수 컬럼을 찾을 수 없습니다.\n성명 외의 다른 컬럼이 필요합니다.');
    }
    const students = rawData.slice(1).filter(row => row[nameColumnIndex] && row[nameColumnIndex].toString().trim()).map(row => {
      const student = {
        name: row[nameColumnIndex].toString().trim()
      };

      // 수행평가 점수들 추가
      scoreColumns.forEach((scoreCol, index) => {
        const scoreValue = row[scoreCol.index];
        // 숫자로 변환, 실패하면 0
        let numericScore = 0;
        if (scoreValue !== undefined && scoreValue !== null && scoreValue !== '') {
          const parsed = parseFloat(scoreValue.toString().replace(/[^\d.-]/g, ''));
          numericScore = isNaN(parsed) ? 0 : parsed;
        }
        student[`score${index + 1}`] = numericScore;
        student[`score${index + 1}Name`] = scoreCol.name;
      });
      return student;
    });
    if (students.length === 0) {
      throw new Error('유효한 학생 데이터를 찾을 수 없습니다.\n이름이 입력된 행이 있는지 확인해주세요.');
    }
    return {
      students,
      scoreColumns
    };
  };

  // 텍스트 입력 처리
  const handleTextInput = () => {
    if (!textInput.trim()) {
      setError('텍스트를 입력해주세요.');
      return;
    }
    try {
      setIsLoading(true);
      setError('');

      // 텍스트를 행별로 분리
      const lines = textInput.trim().split('\n').filter(line => line.trim());

      // 탭, 쉼표, 공백으로 구분된 데이터 처리
      const rawData = lines.map(line => {
        if (line.includes('\t')) {
          return line.split('\t').map(cell => cell.trim());
        } else if (line.includes(',')) {
          return line.split(',').map(cell => cell.trim());
        } else {
          return line.split(/\s+/);
        }
      });
      const {
        students
      } = processStudentData(rawData);
      setStudentData(students);
      setFileUploaded(true);
      setIsLoading(false);
    } catch (err) {
      setError(err.message || '텍스트 데이터를 처리하는 중 오류가 발생했습니다.');
      setIsLoading(false);
    }
  };

  // 파일 업로드 처리
  const handleFileUpload = async event => {
    const file = event.target.files[0];
    if (!file) return;
    setIsLoading(true);
    setError('');
    try {
      const fileExtension = file.name.toLowerCase().split('.').pop();
      let rawData = [];
      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        // Excel 파일 처리
        const reader = new FileReader();
        reader.onload = async e => {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {
              type: 'array'
            });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            rawData = XLSX.utils.sheet_to_json(worksheet, {
              header: 1
            });
            const {
              students
            } = processStudentData(rawData);
            setStudentData(students);
            setFileUploaded(true);
            setIsLoading(false);
          } catch (err) {
            setError(err.message || 'Excel 파일을 읽는 중 오류가 발생했습니다.');
            setIsLoading(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (fileExtension === 'csv') {
        // CSV 파일 처리
        const reader = new FileReader();
        reader.onload = async e => {
          try {
            const csvText = e.target.result;
            // 간단한 CSV 파싱
            const lines = csvText.split('\n').filter(line => line.trim());
            rawData = lines.map(line => {
              // 쉼표로 구분하되, 따옴표 안의 쉼표는 무시
              const result = [];
              let current = '';
              let inQuotes = false;
              for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                  inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                  result.push(current.trim());
                  current = '';
                } else {
                  current += char;
                }
              }
              result.push(current.trim());
              return result;
            });
            const {
              students
            } = processStudentData(rawData);
            setStudentData(students);
            setFileUploaded(true);
            setIsLoading(false);
          } catch (err) {
            setError(err.message || 'CSV 파일을 읽는 중 오류가 발생했습니다.');
            setIsLoading(false);
          }
        };
        reader.readAsText(file, 'UTF-8');
      } else if (fileExtension === 'txt') {
        // 텍스트 파일 처리
        const reader = new FileReader();
        reader.onload = async e => {
          try {
            const textContent = e.target.result;
            const lines = textContent.split('\n').filter(line => line.trim());

            // 탭, 쉼표, 공백으로 구분된 데이터 처리
            rawData = lines.map(line => {
              if (line.includes('\t')) {
                return line.split('\t').map(cell => cell.trim());
              } else if (line.includes(',')) {
                return line.split(',').map(cell => cell.trim());
              } else {
                return line.split(/\s+/);
              }
            });
            const {
              students
            } = processStudentData(rawData);
            setStudentData(students);
            setFileUploaded(true);
            setIsLoading(false);
          } catch (err) {
            setError(err.message || '텍스트 파일을 읽는 중 오류가 발생했습니다.');
            setIsLoading(false);
          }
        };
        reader.readAsText(file, 'UTF-8');
      } else {
        setError('지원되지 않는 파일 형식입니다. Excel(.xlsx, .xls), CSV(.csv), 텍스트(.txt) 파일을 사용해주세요.');
        setIsLoading(false);
      }
    } catch (err) {
      setError('파일 업로드 중 오류가 발생했습니다.');
      setIsLoading(false);
    }
  };

  // 초기화
  const handleReset = () => {
    setStudentData([]);
    setSearchName('');
    setSearchResult(null);
    setError('');
    setFileUploaded(false);
    setIsSearchFocused(false);
    setIsTyping(false);
    setInputMethod('file');
    setTextInput('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 학생 검색
  const handleSearch = () => {
    if (!searchName.trim()) {
      setSearchResult(null);
      setIsTyping(false);
      return;
    }
    const student = studentData.find(s => s.name.toLowerCase().includes(searchName.toLowerCase().trim()));
    if (student) {
      setSearchResult(student);
    } else {
      setSearchResult('not_found');
    }
    setIsTyping(false);
  };

  // 검색창 입력 처리
  const handleSearchChange = e => {
    setSearchName(e.target.value);
    setIsTyping(true);
    setSearchResult(null); // 입력 중에는 이전 결과 숨김
  };

  // 검색창 포커스 처리
  const handleSearchFocus = () => {
    setIsSearchFocused(true);
    if (!searchName.trim()) {
      setSearchResult(null);
    }
  };
  const handleSearchBlur = () => {
    // 약간의 지연을 두어 검색 버튼 클릭이 가능하도록 함
    setTimeout(() => setIsSearchFocused(false), 100);
  };

  // 엔터키 처리
  const handleKeyPress = e => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // 파일 업로드가 되지 않은 경우
  if (!fileUploaded) {
    return /*#__PURE__*/React.createElement("div", {
      className: "min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "max-w-2xl w-full"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-xl shadow-lg p-8"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-center mb-6"
    }, /*#__PURE__*/React.createElement(BookOpen, {
      className: "w-16 h-16 text-indigo-600 mx-auto mb-4"
    }), /*#__PURE__*/React.createElement("h1", {
      className: "text-2xl font-bold text-gray-800 mb-2"
    }, "수행평가 점수 조회"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-600"
    }, "파일 업로드 또는 직접 입력으로 시작하세요")), /*#__PURE__*/React.createElement("div", {
      className: "flex mb-6 bg-gray-100 rounded-lg p-1"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setInputMethod('file'),
      className: `flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md transition-colors ${inputMethod === 'file' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`
    }, /*#__PURE__*/React.createElement(Upload, {
      className: "w-4 h-4"
    }), "파일 업로드"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setInputMethod('text'),
      className: `flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md transition-colors ${inputMethod === 'text' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`
    }, /*#__PURE__*/React.createElement(Type, {
      className: "w-4 h-4"
    }), "직접 입력")), inputMethod === 'file' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-gray-500 mb-4 text-left"
    }, /*#__PURE__*/React.createElement("p", {
      className: "mb-1"
    }, "📋 ", /*#__PURE__*/React.createElement("strong", null, "지원 형식:")), /*#__PURE__*/React.createElement("ul", {
      className: "list-disc list-inside space-y-1 ml-2"
    }, /*#__PURE__*/React.createElement("li", null, "Excel 파일 (.xlsx, .xls)"), /*#__PURE__*/React.createElement("li", null, "CSV 파일 (.csv)"), /*#__PURE__*/React.createElement("li", null, "텍스트 파일 (.txt) - 탭, 쉼표, 공백으로 구분")), /*#__PURE__*/React.createElement("p", {
      className: "mt-3 mb-1"
    }, "📝 ", /*#__PURE__*/React.createElement("strong", null, "필수 조건:")), /*#__PURE__*/React.createElement("ul", {
      className: "list-disc list-inside space-y-1 ml-2"
    }, /*#__PURE__*/React.createElement("li", null, "첫 번째 행은 헤더 (컬럼명)"), /*#__PURE__*/React.createElement("li", null, "성명 관련 컬럼: '성명', '이름', '학생명' 등"), /*#__PURE__*/React.createElement("li", null, "점수 관련 컬럼: '점수', '평가', '수행' 등 포함"))), /*#__PURE__*/React.createElement("input", {
      ref: fileInputRef,
      type: "file",
      accept: ".xlsx,.xls,.csv,.txt",
      onChange: handleFileUpload,
      className: "hidden",
      id: "file-upload"
    }), /*#__PURE__*/React.createElement("label", {
      htmlFor: "file-upload",
      className: "cursor-pointer bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium inline-flex items-center gap-2 w-full justify-center"
    }, /*#__PURE__*/React.createElement(Upload, {
      className: "w-5 h-5"
    }), "파일 선택 (Excel, CSV, 텍스트)")), inputMethod === 'text' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-gray-500 mb-4 text-left"
    }, /*#__PURE__*/React.createElement("p", {
      className: "mb-1"
    }, "📝 ", /*#__PURE__*/React.createElement("strong", null, "입력 형식:")), /*#__PURE__*/React.createElement("ul", {
      className: "list-disc list-inside space-y-1 ml-2"
    }, /*#__PURE__*/React.createElement("li", null, "첫 번째 줄: 헤더 (성명, 수행평가 제목들)"), /*#__PURE__*/React.createElement("li", null, "각 줄: 학생 데이터 (탭으로 구분)"), /*#__PURE__*/React.createElement("li", null, "성명과 점수는 탭(\\t)으로 구분해주세요"))), /*#__PURE__*/React.createElement("textarea", {
      value: textInput,
      onChange: e => setTextInput(e.target.value),
      placeholder: `성명\t수행평가영역1\t수행평가영역2\n김학생\t94.00\t100.00\n이학생\t100.00\t95.00\n박학생\t88.00\t92.00`,
      className: "w-full h-40 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm font-mono"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: handleTextInput,
      className: "mt-3 bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium inline-flex items-center gap-2 w-full justify-center"
    }, /*#__PURE__*/React.createElement(FileText, {
      className: "w-5 h-5"
    }), "데이터 불러오기")), isLoading && /*#__PURE__*/React.createElement("div", {
      className: "mt-4 text-center"
    }, /*#__PURE__*/React.createElement("div", {
      className: "animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-2"
    }), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-600"
    }, "데이터를 처리 중...")), error && /*#__PURE__*/React.createElement("div", {
      className: "mt-4 bg-red-50 border border-red-200 rounded-lg p-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2 text-red-600 font-medium mb-2"
    }, /*#__PURE__*/React.createElement(HelpCircle, {
      className: "w-5 h-5"
    }), "오류가 발생했습니다"), /*#__PURE__*/React.createElement("p", {
      className: "text-red-600 text-sm whitespace-pre-line"
    }, error)))));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "max-w-4xl mx-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center mb-8"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "text-4xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-3"
  }, /*#__PURE__*/React.createElement(BookOpen, {
    className: "text-indigo-600"
  }), "수행평가 점수 조회"), /*#__PURE__*/React.createElement("p", {
    className: "text-gray-600"
  }, "학생 이름을 입력하여 수행평가 점수를 확인하세요"), /*#__PURE__*/React.createElement("div", {
    className: "mt-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm inline-block"
  }, "✅ 총 ", studentData.length, "명의 학생 데이터 로드 완료")), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-xl shadow-lg p-6 mb-6"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-3 mb-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1 relative"
  }, /*#__PURE__*/React.createElement(Search, {
    className: "absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5"
  }), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: searchName,
    onChange: handleSearchChange,
    onKeyPress: handleKeyPress,
    onFocus: handleSearchFocus,
    onBlur: handleSearchBlur,
    placeholder: "학생 이름을 입력하세요...",
    className: "w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: handleSearch,
    className: "bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
  }, "검색"), /*#__PURE__*/React.createElement("button", {
    onClick: handleReset,
    className: "bg-gray-500 text-white px-4 py-3 rounded-lg hover:bg-gray-600 transition-colors font-medium flex items-center gap-2"
  }, /*#__PURE__*/React.createElement(RotateCcw, {
    className: "w-5 h-5"
  }), "성적 업로드")), isTyping ?
  /*#__PURE__*/
  // 입력 중일 때 - 아무것도 표시하지 않음
  React.createElement("div", {
    className: "h-32"
  }) : searchResult && searchResult !== 'not_found' ?
  /*#__PURE__*/
  // 검색 결과가 있을 때
  React.createElement("div", {
    className: "bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3 mb-4"
  }, /*#__PURE__*/React.createElement(User, {
    className: "text-green-600 w-6 h-6"
  }), /*#__PURE__*/React.createElement("h3", {
    className: "text-xl font-bold text-gray-800"
  }, searchResult.name)), /*#__PURE__*/React.createElement("div", {
    className: "grid gap-4",
    style: {
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))'
    }
  }, Object.keys(searchResult).filter(key => key.startsWith('score') && !key.includes('Name') && typeof searchResult[key] === 'number').map((scoreKey, index) => {
    const scoreNameKey = `${scoreKey}Name`;
    const scoreName = searchResult[scoreNameKey] || `수행평가 ${index + 1}`;
    const colorClasses = [{
      icon: 'text-blue-600',
      text: 'text-blue-600'
    }, {
      icon: 'text-purple-600',
      text: 'text-purple-600'
    }, {
      icon: 'text-green-600',
      text: 'text-green-600'
    }, {
      icon: 'text-yellow-600',
      text: 'text-yellow-600'
    }, {
      icon: 'text-red-600',
      text: 'text-red-600'
    }, {
      icon: 'text-indigo-600',
      text: 'text-indigo-600'
    }];
    const colorClass = colorClasses[index % colorClasses.length];
    return /*#__PURE__*/React.createElement("div", {
      key: scoreKey,
      className: "bg-white rounded-lg p-4 border border-green-100"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2 mb-2"
    }, /*#__PURE__*/React.createElement(Award, {
      className: `${colorClass.icon} w-5 h-5`
    }), /*#__PURE__*/React.createElement("h4", {
      className: "font-semibold text-gray-700 text-sm"
    }, scoreName)), /*#__PURE__*/React.createElement("div", {
      className: `text-3xl font-bold ${colorClass.text}`
    }, searchResult[scoreKey], "점"));
  })), (() => {
    const scores = Object.keys(searchResult).filter(key => key.startsWith('score') && !key.includes('Name') && typeof searchResult[key] === 'number').map(key => searchResult[key]);
    if (scores.length > 1) {
      const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      return /*#__PURE__*/React.createElement("div", {
        className: "mt-4 text-center"
      }, /*#__PURE__*/React.createElement("span", {
        className: "text-sm text-gray-600"
      }, "평균: "), /*#__PURE__*/React.createElement("span", {
        className: "text-lg font-bold text-gray-800"
      }, average.toFixed(1), "점"));
    }
    return null;
  })()) : searchResult === 'not_found' ?
  /*#__PURE__*/
  // 검색 결과가 없을 때
  React.createElement("div", {
    className: "bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center"
  }, /*#__PURE__*/React.createElement(HelpCircle, {
    className: "text-yellow-600 w-12 h-12 mx-auto mb-3"
  }), /*#__PURE__*/React.createElement("h3", {
    className: "text-lg font-bold text-yellow-800 mb-2"
  }, "학생을 찾을 수 없습니다"), /*#__PURE__*/React.createElement("p", {
    className: "text-yellow-700"
  }, "'", searchName, "' 학생의 정보가 없습니다."), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-yellow-600 mt-2"
  }, "• 이름을 정확히 입력했는지 확인해주세요", /*#__PURE__*/React.createElement("br", null), "• 띄어쓰기나 특수문자를 확인해주세요")) : isSearchFocused || searchName ?
  /*#__PURE__*/
  // 검색창에 포커스되었거나 텍스트가 있을 때 - 궁금증 유발 화면
  React.createElement("div", {
    className: "bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-8 text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-center mb-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement(Eye, {
    className: "text-indigo-400 w-16 h-16 animate-pulse"
  }), /*#__PURE__*/React.createElement(HelpCircle, {
    className: "text-purple-500 w-8 h-8 absolute -top-2 -right-2 animate-bounce"
  }))), /*#__PURE__*/React.createElement("h3", {
    className: "text-xl font-bold text-gray-700 mb-2"
  }, "🔍 과연 내 점수는?"), /*#__PURE__*/React.createElement("p", {
    className: "text-gray-600 mb-2"
  }, "궁금하다면 이름을 입력하고 검색해보세요!"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-indigo-600 font-medium"
  }, "✨ 놀라운 결과가 기다리고 있어요")) :
  /*#__PURE__*/
  // 기본 상태
  React.createElement("div", {
    className: "bg-gray-50 border border-gray-200 rounded-lg p-8 text-center"
  }, /*#__PURE__*/React.createElement(Search, {
    className: "text-gray-400 w-12 h-12 mx-auto mb-3"
  }), /*#__PURE__*/React.createElement("p", {
    className: "text-gray-600"
  }, "학생 이름을 입력하여 점수를 조회하세요")))));
};
ReactDOM.render(/*#__PURE__*/React.createElement(StudentScoreApp, null), document.getElementById('root'));